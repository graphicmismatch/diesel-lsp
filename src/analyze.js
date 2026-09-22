'use strict';

const { parse } = require('./parser');
const catalog = require('./catalog');

const ERROR = 1;
const WARNING = 2;

function analyze(text) {
  const file = parse(text);
  const diagnostics = file.diagnostics.slice();
  const patches = [];
  if (file.patch) walk(file.patch, diagnostics, patches, true);
  return { file, diagnostics, patches, patch: file.patch };
}

// Every rule below mirrors one that Petroleum itself enforces when loading or
// building a patch, so anything reported here would really fail in the app.
function walk(patch, diagnostics, patches, topLevel) {
  const byName = new Map();
  patches.push(patch);

  for (const node of patch.nodes) {
    if (!node.name) continue;
    if (byName.has(node.name)) {
      diagnostics.push({
        severity: ERROR,
        range: node.nameRange,
        message: `Node '${node.name}' is already declared in this patch`,
      });
    } else {
      byName.set(node.name, node);
    }
    if (!catalog.isKnownType(node.type)) {
      diagnostics.push({
        severity: ERROR,
        range: node.typeRange,
        message: `Unknown node type '${node.type}'${typeHint(node.type)}`,
      });
    }
    checkPortValues(node, diagnostics);
    for (const field of node.fields) {
      if (field.value && field.value.type === 'patch') {
        walk(field.value.value, diagnostics, patches, false);
      }
    }
  }

  if (topLevel) {
    const sinks = patch.nodes.filter(node => catalog.isAudioOut(node.type));
    if (sinks.length === 0) {
      diagnostics.push({
        severity: WARNING,
        range: patch.nameRange || headerRange(patch),
        message: 'This patch has no Audio Out node, so it cannot be played or rendered',
      });
    } else if (sinks.length > 1) {
      for (const extra of sinks.slice(1)) {
        diagnostics.push({
          severity: ERROR,
          range: extra.typeRange,
          message: 'A patch must contain exactly one Audio Out node',
        });
      }
    }
  }

  const driven = new Map();
  for (const connection of patch.connections) {
    checkEnd(connection.from, 'source', byName, diagnostics);
    checkEnd(connection.to, 'destination', byName, diagnostics);
    if (connection.to.node && connection.to.port && byName.has(connection.to.node)) {
      const key = `${connection.to.node}.${connection.to.port}`;
      if (driven.has(key)) {
        diagnostics.push({
          severity: ERROR,
          range: connection.to.range,
          message: `Input '${connection.to.port}' on ${connection.to.node} is already driven by another connection`,
        });
      } else {
        driven.set(key, connection);
      }
    }
  }

  for (const macro of patch.macros) {
    if (macro.target && !byName.has(macro.target)) {
      diagnostics.push({
        severity: ERROR,
        range: macro.targetRange,
        message: `Unknown node '${macro.target}' (declare a node before referring to it)`,
      });
    } else if (macro.target) {
      const target = byName.get(macro.target);
      if (target.type !== 'Constant') {
        diagnostics.push({
          severity: WARNING,
          range: macro.targetRange,
          message: `A macro should target a Constant node; '${macro.target}' is a ${target.type}`,
        });
      }
    }
    if (macro.min !== null && macro.max !== null && macro.min > macro.max) {
      diagnostics.push({
        severity: WARNING,
        range: macro.range,
        message: `Macro '${macro.name}' has min ${macro.min} above max ${macro.max}`,
      });
    }
  }
}

// The most common mistake: writing a waveform name as a node type. Waveforms are
// not node types in Diesel - they are the `oscillator` field of an Oscillator node.
function typeHint(type) {
  if (catalog.oscillators().includes(type)) {
    return ` - waveforms are written as: Oscillator name { oscillator = { kind = "factory", name = "${type}" }; }`;
  }
  const known = catalog.nodeTypes();
  const lower = String(type).toLowerCase();
  const close = known.filter(candidate => candidate.toLowerCase().startsWith(lower.slice(0, 3)));
  return close.length ? ` - did you mean ${close.slice(0, 3).map(name => `'${name}'`).join(', ')}?` : '';
}

function headerRange(patch) {
  return { start: patch.range.start, end: { line: patch.range.start.line, character: patch.range.start.character + 5 } };
}

function checkPortValues(node, diagnostics) {
  const fieldKeys = node.fields.map(field => field.key);
  if (!catalog.hasFixedPorts(node.type, fieldKeys)) return;
  const inputs = catalog.inputPorts(node.type) || [];
  for (const portValue of node.portValues) {
    if (portValue.port && !inputs.includes(portValue.port)) {
      diagnostics.push({
        severity: ERROR,
        range: portValue.portRange,
        message: `${node.type} has no input '${portValue.port}'${suggest(portValue.port, inputs)}`,
      });
    }
  }
}

function checkEnd(end, role, byName, diagnostics) {
  if (!end.node) return;
  const node = byName.get(end.node);
  if (!node) {
    diagnostics.push({
      severity: ERROR,
      range: end.nodeRange,
      message: `Unknown node '${end.node}' (declare a node before referring to it)`,
    });
    return;
  }
  if (!end.port) return;
  const fieldKeys = node.fields.map(field => field.key);
  if (!catalog.hasFixedPorts(node.type, fieldKeys)) return;
  const ports = role === 'source' ? catalog.outputPorts(node.type) : catalog.inputPorts(node.type);
  if (ports && !ports.includes(end.port)) {
    const what = role === 'source' ? 'output' : 'input';
    diagnostics.push({
      severity: ERROR,
      range: end.portRange,
      message: `${node.type} has no ${what} '${end.port}'${suggest(end.port, ports)}`,
    });
  }
}

function suggest(word, options) {
  const lower = String(word).toLowerCase();
  const close = options.filter(option => {
    const other = option.toLowerCase();
    return other.startsWith(lower.slice(0, 2)) || distance(other, lower) <= 2;
  });
  if (close.length === 0) {
    return options.length ? ` - try one of: ${options.join(', ')}` : '';
  }
  return ` - did you mean ${close.slice(0, 3).map(option => `'${option}'`).join(', ')}?`;
}

function distance(a, b) {
  const rows = [];
  for (let i = 0; i <= a.length; i++) rows.push([i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

module.exports = { analyze };
