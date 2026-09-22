'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'bin', 'diesel-lsp.js');
const URI = 'file:///tmp/test.dsl';

const SOURCE = `patch "Demo" {
    Phasor osc1 { x = 0; y = 0; .frequency = 440; }
    "Audio Out" out1 { x = 260; y = 0; }
    Constant k1 { x = 0; y = 200; }
    osc1.out -> out1.in;
    macro "level" -> k1(0, 1);
    Nope broken1;
}
`;

// Speaks the real wire protocol (Content-Length framing over stdio) rather than
// calling the handlers directly, so the framing itself is covered.
class Client {
  constructor() {
    this.child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.nextId = 1;
    this.child.stdout.on('data', chunk => this.receive(chunk));
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.slice(0, headerEnd).toString())[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const message = JSON.parse(this.buffer.slice(start, start + length).toString('utf8'));
      this.buffer = this.buffer.slice(start + length);
      if (message.id !== undefined && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      } else if (message.method) {
        this.notifications.push(message);
        this.waiters = this.waiters.filter(waiter => !waiter(message));
      }
    }
  }

  send(message) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise(resolve => {
      this.pending.set(id, message => resolve(message.result));
      this.send({ id, method, params });
    });
  }

  notify(method, params) {
    this.send({ method, params });
  }

  waitForNotification(method) {
    const existing = this.notifications.find(message => message.method === method);
    if (existing) return Promise.resolve(existing);
    return new Promise(resolve => {
      this.waiters.push(message => {
        if (message.method !== method) return false;
        resolve(message);
        return true;
      });
    });
  }

  stop() {
    this.child.kill();
  }
}

async function open(source = SOURCE) {
  const client = new Client();
  const initialize = await client.request('initialize', { capabilities: {} });
  client.notify('initialized', {});
  client.notify('textDocument/didOpen', {
    textDocument: { uri: URI, languageId: 'diesel', version: 1, text: source },
  });
  return { client, initialize };
}

test('advertises its capabilities and publishes diagnostics on open', async () => {
  const { client, initialize } = await open();
  try {
    assert.strictEqual(initialize.capabilities.hoverProvider, true);
    assert.strictEqual(initialize.capabilities.definitionProvider, true);
    assert.strictEqual(initialize.capabilities.documentSymbolProvider, true);
    assert.deepStrictEqual(initialize.capabilities.completionProvider.triggerCharacters, ['.', '"']);
    const published = await client.waitForNotification('textDocument/publishDiagnostics');
    assert.strictEqual(published.params.uri, URI);
    assert.strictEqual(published.params.diagnostics.length, 1);
    assert.match(published.params.diagnostics[0].message, /Unknown node type 'Nope'/);
    assert.strictEqual(published.params.diagnostics[0].severity, 1);
    assert.strictEqual(published.params.diagnostics[0].range.start.line, 6);
  } finally {
    client.stop();
  }
});

test('re-publishes diagnostics after an edit', async () => {
  const { client } = await open();
  try {
    await client.waitForNotification('textDocument/publishDiagnostics');
    client.notifications.length = 0;
    client.notify('textDocument/didChange', {
      textDocument: { uri: URI, version: 2 },
      contentChanges: [{ text: SOURCE.replace('    Nope broken1;\n', '') }],
    });
    const published = await client.waitForNotification('textDocument/publishDiagnostics');
    assert.deepStrictEqual(published.params.diagnostics, []);
  } finally {
    client.stop();
  }
});

test('completes ports after a dot, honouring connection direction', async () => {
  const { client } = await open(`patch {
    Phasor osc1 { x = 0; y = 0; }
    "Audio Out" out1 { x = 1; y = 0; }
    osc1.
}
`);
  try {
    const outputs = await client.request('textDocument/completion', {
      textDocument: { uri: URI },
      position: { line: 3, character: 9 },
    });
    assert.deepStrictEqual(outputs.map(item => item.label), ['out']);
  } finally {
    client.stop();
  }
});

test('completes node types elsewhere in a patch', async () => {
  const { client } = await open();
  try {
    const items = await client.request('textDocument/completion', {
      textDocument: { uri: URI },
      position: { line: 6, character: 4 },
    });
    const labels = items.map(item => item.label);
    assert.ok(labels.includes('Phasor'), 'plain type names');
    assert.ok(labels.includes('"Audio Out"'), 'types needing quotes are quoted');
    assert.ok(labels.includes('macro'), 'statement keywords');
  } finally {
    client.stop();
  }
});

test('hovers a node type, a port reference and a port value', async () => {
  const { client } = await open();
  try {
    const type = await client.request('textDocument/hover', {
      textDocument: { uri: URI }, position: { line: 1, character: 5 },
    });
    assert.match(type.contents.value, /\*\*Phasor\*\*/);
    assert.match(type.contents.value, /outputs: out/);

    const port = await client.request('textDocument/hover', {
      textDocument: { uri: URI }, position: { line: 4, character: 23 },
    });
    assert.match(port.contents.value, /Audio Out.*in.*input/s);

    const value = await client.request('textDocument/hover', {
      textDocument: { uri: URI }, position: { line: 1, character: 34 },
    });
    assert.match(value.contents.value, /frequency.*unwired port value/s);
  } finally {
    client.stop();
  }
});

test('jumps from a connection and a macro target to the node declaration', async () => {
  const { client } = await open();
  try {
    const fromConnection = await client.request('textDocument/definition', {
      textDocument: { uri: URI }, position: { line: 4, character: 6 },
    });
    assert.strictEqual(fromConnection.range.start.line, 1);
    const fromMacro = await client.request('textDocument/definition', {
      textDocument: { uri: URI }, position: { line: 5, character: 22 },
    });
    assert.strictEqual(fromMacro.range.start.line, 3);
  } finally {
    client.stop();
  }
});

test('lists the patch and its nodes as document symbols', async () => {
  const { client } = await open();
  try {
    const found = await client.request('textDocument/documentSymbol', { textDocument: { uri: URI } });
    assert.strictEqual(found[0].name, 'patch "Demo"');
    const children = found[0].children.map(child => `${child.name}:${child.detail}`);
    assert.ok(children.includes('osc1:Phasor'));
    assert.ok(children.includes('out1:Audio Out'));
    assert.ok(children.some(child => child.startsWith('macro level')));
  } finally {
    client.stop();
  }
});

test('renames a node and every reference to it', async () => {
  const { client } = await open();
  try {
    const edit = await client.request('textDocument/rename', {
      textDocument: { uri: URI }, position: { line: 1, character: 12 }, newName: 'lead',
    });
    const edits = edit.changes[URI];
    assert.strictEqual(edits.length, 2, 'declaration and the connection reference');
    assert.ok(edits.every(entry => entry.newText === 'lead'));
  } finally {
    client.stop();
  }
});
