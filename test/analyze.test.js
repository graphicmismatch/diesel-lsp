'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { analyze } = require('../src/analyze');

const messages = source => analyze(source).diagnostics.map(diagnostic => diagnostic.message);

test('real patches written by Petroleum produce no diagnostics', () => {
  const dir = path.join(__dirname, '..', 'examples');
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.dsl'));
  assert.ok(files.length >= 5, 'examples are present');
  for (const name of files) {
    const found = analyze(fs.readFileSync(path.join(dir, name), 'utf8')).diagnostics;
    assert.deepStrictEqual(found, [], `${name}: ${JSON.stringify(found)}`);
  }
});

test('flags an unknown node type', () => {
  const found = messages('patch { Sinus osc1 { x = 0; } "Audio Out" o1; }');
  assert.ok(found.some(message => message === "Unknown node type 'Sinus'"), found.join(' | '));
});

test('flags unknown ports on a connection, and suggests near misses', () => {
  const found = messages(`patch {
    Phasor osc1;
    "Audio Out" o1;
    osc1.output -> o1.in;
}`);
  assert.ok(found.some(message => /Phasor has no output 'output'/.test(message)), found.join(' | '));
  assert.ok(found.some(message => /did you mean 'out'/.test(message)), found.join(' | '));
});

test('flags an unknown port value inside a node body', () => {
  const found = messages('patch { Phasor osc1 { .cutoff = 3; } "Audio Out" o1; }');
  assert.ok(found.some(message => /Phasor has no input 'cutoff'/.test(message)), found.join(' | '));
});

test('does not check ports on nodes whose arity comes from a field', () => {
  assert.deepStrictEqual(messages(`patch {
    Mix mix1 { ports = ["a", "b"]; }
    "Audio Out" o1;
    mix1.out -> o1.in;
    Phasor osc1;
    osc1.out -> mix1.a;
}`), []);
});

test('does not check ports on codec-only types', () => {
  assert.deepStrictEqual(messages(`patch {
    Tracker tracker1 { channels = 4; }
    "Audio Out" o1;
    Phasor osc1;
    osc1.out -> o1.in;
    tracker1.pitch3 -> osc1.frequency;
}`), []);
});

test('flags duplicate node names and unknown references', () => {
  const found = messages(`patch {
    Phasor osc1;
    Phasor osc1;
    "Audio Out" o1;
    ghost.out -> o1.in;
    macro "m" -> ghost(0, 1);
}`);
  assert.ok(found.some(message => /'osc1' is already declared/.test(message)), found.join(' | '));
  assert.strictEqual(found.filter(message => /Unknown node 'ghost'/.test(message)).length, 2);
});

test('flags an input driven by two connections', () => {
  const found = messages(`patch {
    Phasor osc1;
    Phasor osc2;
    "Audio Out" o1;
    osc1.out -> o1.in;
    osc2.out -> o1.in;
}`);
  assert.ok(found.some(message => /Input 'in' on o1 is already driven/.test(message)), found.join(' | '));
});

test('warns about a missing Audio Out and flags a second one', () => {
  assert.ok(messages('patch { Phasor osc1; }').some(message => /no Audio Out node/.test(message)));
  const two = messages('patch { "Audio Out" a; "Audio Out" b; }');
  assert.ok(two.some(message => /exactly one Audio Out/.test(message)), two.join(' | '));
});

test('warns when a macro targets something other than a Constant', () => {
  const found = messages(`patch {
    Phasor osc1;
    "Audio Out" o1;
    osc1.out -> o1.in;
    macro "wrong" -> osc1(0, 1);
}`);
  assert.ok(found.some(message => /should target a Constant/.test(message)), found.join(' | '));
});

test('checks nested patch bodies too', () => {
  const found = messages(`patch {
    "Audio Out" o1;
    Patch p1 { patch = patch "Inner" { Nope bad1; }; }
}`);
  assert.ok(found.some(message => /Unknown node type 'Nope'/.test(message)), found.join(' | '));
});
