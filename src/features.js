'use strict';

const catalog = require('./catalog');

const KIND = { CLASS: 7, FIELD: 5, PROPERTY: 10, VARIABLE: 13, VALUE: 12, KEYWORD: 14 };
const SYMBOL = { MODULE: 2, CLASS: 5, FIELD: 8, VARIABLE: 13 };

function inRange(range, position) {
  if (!range) return false;
  const { start, end } = range;
  if (position.line < start.line || position.line > end.line) return false;
  if (position.line === start.line && position.character < start.character) return false;
  if (position.line === end.line && position.character > end.character) return false;
  return true;
}

function eachNode(patches) {
  return patches.flatMap(patch => patch.nodes.map(node => ({ node, patch })));
}

function nodeAt(result, position) {
  for (const { node, patch } of eachNode(result.patches)) {
    if (inRange(node.typeRange, position)) return { hit: 'type', node, patch };
    if (inRange(node.nameRange, position)) return { hit: 'name', node, patch };
    for (const portValue of node.portValues) {
      if (inRange(portValue.portRange, position)) return { hit: 'portValue', node, patch, portValue };
    }
  }
  for (const patch of result.patches) {
    for (const connection of patch.connections) {
      for (const end of [connection.from, connection.to]) {
        if (inRange(end.nodeRange, position)) return { hit: 'ref', end, patch, connection };
        if (inRange(end.portRange, position)) {
          return { hit: 'refPort', end, patch, connection, role: end === connection.from ? 'source' : 'destination' };
        }
      }
    }
    for (const macro of patch.macros) {
      if (inRange(macro.targetRange, position)) return { hit: 'macroTarget', macro, patch };
    }
  }
  return null;
}

function findDeclaration(patch, name) {
  return patch.nodes.find(node => node.name === name) || null;
}

function lineOf(text, line) {
  return text.split(/\r?\n/)[line] || '';
}

function complete(document, position) {
  const { text, result } = document;
  const line = lineOf(text, position.line);
  const before = line.slice(0, position.character);

  // `osc1.` or `osc1.fr` - complete that node's ports, output ports on the left
  // of an arrow and input ports on the right.
  const portMatch = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/.exec(before);
  if (portMatch) {
    const patch = result.patches.find(candidate => inRange(candidate.bodyRange, position)) || result.patch;
    if (patch) {
      const node = findDeclaration(patch, portMatch[1]);
      if (node) {
        const wantsInput = before.includes('->');
        const ports = wantsInput ? catalog.inputPorts(node.type) : catalog.outputPorts(node.type);
        if (ports) {
          return ports.map(port => ({
            label: port,
            kind: KIND.PROPERTY,
            detail: wantsInput
              ? `${node.type} input (default ${catalog.inputDefault(node.type, port)})`
              : `${node.type} output`,
          }));
        }
      }
      return [];
    }
  }

  // Inside a node body: port values and the usual fields.
  const bodyNode = eachNode(result.patches).find(entry => inRange(entry.node.bodyRange, position));
  if (bodyNode) {
    const items = [];
    const inputs = catalog.inputPorts(bodyNode.node.type) || [];
    for (const port of inputs) {
      items.push({
        label: `.${port}`,
        kind: KIND.FIELD,
        detail: `port value (default ${catalog.inputDefault(bodyNode.node.type, port)})`,
        insertText: `.${port} = `,
      });
    }
    for (const field of ['x', 'y', 'state', 'name']) {
      items.push({ label: field, kind: KIND.PROPERTY, detail: 'node field' });
    }
    if (bodyNode.node.type === 'Oscillator') {
      for (const name of catalog.oscillators()) {
        items.push({ label: name, kind: KIND.VALUE, detail: 'oscillator name' });
      }
    }
    return items;
  }

  // Anywhere else inside a patch: node types, plus the statement keywords.
  const items = catalog.nodeTypes().map(type => ({
    label: /[^A-Za-z0-9_]/.test(type) ? `"${type}"` : type,
    kind: KIND.CLASS,
    detail: catalog.describe(type)
      ? `${catalog.describe(type).inputs.length} in / ${catalog.describe(type).outputs.length} out`
      : 'node type',
    documentation: { kind: 'markdown', value: catalog.signature(type) || '' },
  }));
  for (const keyword of ['patch', 'macro', 'sample', 'data']) {
    items.push({ label: keyword, kind: KIND.KEYWORD });
  }
  return items;
}

function hover(document, position) {
  const found = nodeAt(document.result, position);
  if (!found) return null;
  if (found.hit === 'type' || found.hit === 'name') {
    const signature = catalog.signature(found.node.type);
    if (!signature) return null;
    return {
      contents: { kind: 'markdown', value: signature },
      range: found.hit === 'type' ? found.node.typeRange : found.node.nameRange,
    };
  }
  if (found.hit === 'portValue') {
    const fallback = catalog.inputDefault(found.node.type, found.portValue.port);
    return {
      contents: {
        kind: 'markdown',
        value: `\`${found.node.type}.${found.portValue.port}\` - unwired port value`
          + (fallback === null ? '' : ` (default ${fallback})`),
      },
      range: found.portValue.portRange,
    };
  }
  if (found.hit === 'ref' || found.hit === 'macroTarget') {
    const name = found.hit === 'ref' ? found.end.node : found.macro.target;
    const node = findDeclaration(found.patch, name);
    if (!node) return null;
    return {
      contents: { kind: 'markdown', value: catalog.signature(node.type) || `**${node.type}**` },
      range: found.hit === 'ref' ? found.end.nodeRange : found.macro.targetRange,
    };
  }
  if (found.hit === 'refPort') {
    const node = findDeclaration(found.patch, found.end.node);
    if (!node) return null;
    const isSource = found.role === 'source';
    const fallback = isSource ? null : catalog.inputDefault(node.type, found.end.port);
    return {
      contents: {
        kind: 'markdown',
        value: `\`${node.type}.${found.end.port}\` - ${isSource ? 'output' : 'input'}`
          + (fallback === null ? '' : ` (default ${fallback})`),
      },
      range: found.end.portRange,
    };
  }
  return null;
}

function definition(document, position, uri) {
  const found = nodeAt(document.result, position);
  if (!found) return null;
  let name = null;
  if (found.hit === 'ref' || found.hit === 'refPort') name = found.end.node;
  if (found.hit === 'macroTarget') name = found.macro.target;
  if (!name) return null;
  const node = findDeclaration(found.patch, name);
  return node ? { uri, range: node.nameRange } : null;
}

function symbols(document) {
  const build = patch => {
    const children = patch.nodes.map(node => ({
      name: node.name || '(unnamed)',
      detail: node.type,
      kind: SYMBOL.CLASS,
      range: node.range,
      selectionRange: node.nameRange || node.range,
      children: node.fields
        .filter(field => field.value && field.value.type === 'patch')
        .map(field => build(field.value.value)),
    }));
    for (const macro of patch.macros) {
      children.push({
        name: `macro ${macro.name}`,
        detail: macro.target || '',
        kind: SYMBOL.FIELD,
        range: macro.range,
        selectionRange: macro.nameRange,
        children: [],
      });
    }
    return {
      name: patch.name ? `patch "${patch.name}"` : 'patch',
      kind: SYMBOL.MODULE,
      range: patch.range,
      selectionRange: patch.nameRange || patch.range,
      children,
    };
  };
  return document.result.patch ? [build(document.result.patch)] : [];
}

function rename(document, position, newName, uri) {
  const found = nodeAt(document.result, position);
  if (!found) return null;
  let name = null;
  if (found.hit === 'name') name = found.node.name;
  if (found.hit === 'ref' || found.hit === 'refPort') name = found.end.node;
  if (found.hit === 'macroTarget') name = found.macro.target;
  if (!name) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) return null;

  const patch = found.patch;
  const edits = [];
  for (const node of patch.nodes) {
    if (node.name === name && node.nameRange) edits.push({ range: node.nameRange, newText: newName });
  }
  for (const connection of patch.connections) {
    for (const end of [connection.from, connection.to]) {
      if (end.node === name && end.nodeRange) edits.push({ range: end.nodeRange, newText: newName });
    }
  }
  for (const macro of patch.macros) {
    if (macro.target === name && macro.targetRange) edits.push({ range: macro.targetRange, newText: newName });
  }
  return { changes: { [uri]: edits } };
}

module.exports = { complete, hover, definition, symbols, rename, inRange };
