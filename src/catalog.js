'use strict';

const fs = require('fs');
const path = require('path');

// data/nodes.json is generated from Petroleum's own NodeFactory - see tools/Catalog.java.
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'nodes.json'), 'utf8'));

// Types PatchCodec writes that NodeFactory does not register, because they need a
// constructor argument (a sample, an oscillator, a channel count, an embedded patch).
// Their ports depend on that argument, so ports are not checked for them.
const CODEC_TYPES = new Set([
  'Oscillator',
  'Patch',
  'Granular Player',
  'Instrument',
  'Tracker',
  'MIDI Player',
  'Piano Roll',
  'Additive Resynth',
]);

// A field in a node body that changes how many ports the node has. When one is
// present the recorded port list no longer describes the node, so ports go unchecked.
const ARITY_FIELDS = new Set(['outputs', 'inputs', 'steps', 'bands', 'ports', 'channels', 'voices']);

const AUDIO_OUT_TYPES = Object.keys(catalog.nodes).filter(name => /audio out/i.test(name));

function nodeTypes() {
  return Object.keys(catalog.nodes);
}

function oscillators() {
  return catalog.oscillators.slice();
}

function isKnownType(type) {
  return Object.prototype.hasOwnProperty.call(catalog.nodes, type) || CODEC_TYPES.has(type);
}

function describe(type) {
  return catalog.nodes[type] || null;
}

function inputPorts(type) {
  const entry = catalog.nodes[type];
  return entry ? entry.inputs.map(port => port.name) : null;
}

function outputPorts(type) {
  const entry = catalog.nodes[type];
  return entry ? entry.outputs.slice() : null;
}

function inputDefault(type, port) {
  const entry = catalog.nodes[type];
  if (!entry) return null;
  const found = entry.inputs.find(input => input.name === port);
  return found ? found.default : null;
}

function hasFixedPorts(type, fieldKeys) {
  if (!catalog.nodes[type]) return false;
  return !fieldKeys.some(key => ARITY_FIELDS.has(key));
}

function isAudioOut(type) {
  return AUDIO_OUT_TYPES.includes(type);
}

function signature(type) {
  const entry = catalog.nodes[type];
  if (!entry) {
    return CODEC_TYPES.has(type)
      ? `${type} - ports depend on how the node was created (samples, channel count, embedded patch)`
      : null;
  }
  const inputs = entry.inputs.length
    ? entry.inputs.map(port => `${port.name} = ${port.default}`).join(', ')
    : '(none)';
  const outputs = entry.outputs.length ? entry.outputs.join(', ') : '(none)';
  return `**${type}**\n\n- inputs: ${inputs}\n- outputs: ${outputs}`;
}

module.exports = {
  nodeTypes,
  oscillators,
  isKnownType,
  describe,
  inputPorts,
  outputPorts,
  inputDefault,
  hasFixedPorts,
  isAudioOut,
  signature,
  AUDIO_OUT_TYPES,
  CODEC_TYPES,
};
