'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { tokenize } = require('../src/lexer');
const { parse } = require('../src/parser');

test('lexes the token kinds Diesel defines', () => {
  const { tokens, errors } = tokenize('patch "a" { x = -1.5e3; } data d = b64"AAA="; // tail');
  assert.deepStrictEqual(errors, []);
  const kinds = tokens.map(token => token.kind);
  assert.ok(kinds.includes('IDENT') && kinds.includes('STRING') && kinds.includes('NUMBER'));
  assert.ok(kinds.includes('BLOB') && kinds.includes('PUNCT'));
  assert.strictEqual(tokens[tokens.length - 1].kind, 'END');
  assert.strictEqual(tokens.find(token => token.kind === 'NUMBER').value, '-1.5e3');
  assert.strictEqual(tokens.find(token => token.kind === 'BLOB').value, 'AAA=');
});

test('handles string escapes and block comments', () => {
  const { tokens, errors } = tokenize('/* c */ "a\\"b\\n" /* multi\nline */ x');
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(tokens[0].value, 'a"b\n');
  assert.strictEqual(tokens[1].value, 'x');
  assert.strictEqual(tokens[1].start.line, 1, 'lines counted through block comments');
});

test('reports unterminated strings and comments instead of throwing', () => {
  assert.strictEqual(tokenize('"open').errors.length, 1);
  assert.strictEqual(tokenize('/* open').errors.length, 1);
  assert.strictEqual(tokenize('patch { $ }').errors[0].message, "Unexpected character '$'");
});

test('parses nodes, connections, macros and port values', () => {
  const file = parse(`patch "Demo" {
    version = 6;
    Phasor osc1 { x = 0; y = 1; .frequency = 440; }
    "Audio Out" out1 { x = 2; y = 3; }
    Constant k1;
    osc1.out -> out1.in;
    macro "cutoff" -> k1(20, 20000);
}`);
  assert.deepStrictEqual(file.diagnostics, []);
  const patch = file.patch;
  assert.strictEqual(patch.name, 'Demo');
  assert.deepStrictEqual(patch.nodes.map(node => node.name), ['osc1', 'out1', 'k1']);
  assert.deepStrictEqual(patch.nodes.map(node => node.type), ['Phasor', 'Audio Out', 'Constant']);
  assert.strictEqual(patch.nodes[0].portValues[0].port, 'frequency');
  assert.strictEqual(patch.nodes[0].portValues[0].value, 440);
  assert.strictEqual(patch.fields[0].key, 'version');
  assert.deepStrictEqual(
    [patch.connections[0].from.node, patch.connections[0].from.port,
      patch.connections[0].to.node, patch.connections[0].to.port],
    ['osc1', 'out', 'out1', 'in'],
  );
  assert.strictEqual(patch.macros[0].name, 'cutoff');
  assert.strictEqual(patch.macros[0].target, 'k1');
  assert.strictEqual(patch.macros[0].max, 20000);
});

test('parses every value kind, including a nested patch', () => {
  const file = parse(`patch {
    Oscillator o1 {
      weights = [1, 0.5];
      oscillator = { kind = "factory", name = "Sine" };
      enabled = true;
      mode = linear;
    }
    Patch p1 { patch = patch "Inner" { Constant c1; }; }
}`);
  assert.deepStrictEqual(file.diagnostics, []);
  const fields = file.patch.nodes[0].fields;
  assert.strictEqual(fields[0].value.type, 'array');
  assert.strictEqual(fields[1].value.entries[1].value.value, 'Sine');
  assert.strictEqual(fields[2].value.value, true);
  assert.strictEqual(fields[3].value.type, 'identifier');
  const nested = file.patch.nodes[1].fields[0].value;
  assert.strictEqual(nested.type, 'patch');
  assert.strictEqual(nested.value.name, 'Inner');
});

test('rejects assigning id/type/portValues inside a node body', () => {
  const file = parse('patch { Phasor osc1 { id = "x"; } }');
  assert.match(file.diagnostics[0].message, /'id' cannot be assigned inside a node body/);
});

test('reports a second top-level patch', () => {
  const file = parse('patch { } patch { }');
  assert.match(file.diagnostics[0].message, /exactly one top-level patch/);
});

test('recovers from a bad statement and keeps parsing the rest', () => {
  const file = parse(`patch {
    Phasor osc1 { x = 0; }
    ??? ;
    "Audio Out" out1 { x = 1; }
}`);
  assert.ok(file.diagnostics.length > 0, 'the bad line is reported');
  assert.deepStrictEqual(file.patch.nodes.map(node => node.name), ['osc1', 'out1'],
    'nodes on both sides of the error still parse');
});

test('an empty document reports the missing patch once', () => {
  const file = parse('');
  assert.strictEqual(file.diagnostics.length, 1);
  assert.match(file.diagnostics[0].message, /Missing top-level/);
});
