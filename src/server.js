'use strict';

const { analyze } = require('./analyze');
const catalog = require('./catalog');
const features = require('./features');

// Minimal LSP framing: `Content-Length: n\r\n\r\n` + JSON-RPC body, over stdio.
// Written by hand so the server installs and runs with no dependencies at all.
class Connection {
  constructor(input, output) {
    this.output = output;
    this.handlers = new Map();
    this.buffer = Buffer.alloc(0);
    input.on('data', chunk => this.receive(chunk));
  }

  on(method, handler) {
    this.handlers.set(method, handler);
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString('ascii');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.slice(start, start + length).toString('utf8');
      this.buffer = this.buffer.slice(start + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch (ex) {
        continue;
      }
      this.dispatch(message);
    }
  }

  dispatch(message) {
    const handler = this.handlers.get(message.method);
    if (!handler) {
      if (message.id !== undefined) this.send({ id: message.id, result: null });
      return;
    }
    let result;
    try {
      result = handler(message.params || {});
    } catch (ex) {
      if (message.id !== undefined) {
        this.send({ id: message.id, error: { code: -32603, message: String(ex && ex.stack || ex) } });
      }
      return;
    }
    if (message.id !== undefined) this.send({ id: message.id, result: result === undefined ? null : result });
  }

  send(message) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
    this.output.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.output.write(body);
  }

  notify(method, params) {
    this.send({ method, params });
  }
}

function start(input = process.stdin, output = process.stdout) {
  const connection = new Connection(input, output);
  const documents = new Map();

  const refresh = (uri, text) => {
    const result = analyze(text);
    documents.set(uri, { text, result });
    connection.notify('textDocument/publishDiagnostics', {
      uri,
      diagnostics: result.diagnostics.map(diagnostic => ({
        range: diagnostic.range,
        severity: diagnostic.severity,
        source: 'diesel',
        message: diagnostic.message,
      })),
    });
    return result;
  };

  const documentFor = params => documents.get(params.textDocument.uri);

  connection.on('initialize', () => ({
    capabilities: {
      textDocumentSync: { openClose: true, change: 1 },
      completionProvider: { triggerCharacters: ['.', '"'], resolveProvider: false },
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      renameProvider: { prepareProvider: false },
      documentFormattingProvider: false,
    },
    serverInfo: { name: 'diesel-lsp', version: require('../package.json').version },
  }));

  connection.on('initialized', () => undefined);
  connection.on('shutdown', () => null);
  connection.on('exit', () => process.exit(0));

  connection.on('textDocument/didOpen', params => {
    refresh(params.textDocument.uri, params.textDocument.text);
  });

  connection.on('textDocument/didChange', params => {
    const change = params.contentChanges[params.contentChanges.length - 1];
    if (change) refresh(params.textDocument.uri, change.text);
  });

  connection.on('textDocument/didClose', params => {
    documents.delete(params.textDocument.uri);
    connection.notify('textDocument/publishDiagnostics', { uri: params.textDocument.uri, diagnostics: [] });
  });

  connection.on('textDocument/completion', params => {
    const document = documentFor(params);
    return document ? features.complete(document, params.position) : [];
  });

  connection.on('textDocument/hover', params => {
    const document = documentFor(params);
    return document ? features.hover(document, params.position) : null;
  });

  connection.on('textDocument/definition', params => {
    const document = documentFor(params);
    return document ? features.definition(document, params.position, params.textDocument.uri) : null;
  });

  connection.on('textDocument/documentSymbol', params => {
    const document = documentFor(params);
    return document ? features.symbols(document) : [];
  });

  connection.on('textDocument/rename', params => {
    const document = documentFor(params);
    return document ? features.rename(document, params.position, params.newName, params.textDocument.uri) : null;
  });

  return { connection, documents, catalog };
}

module.exports = { start, Connection };

if (require.main === module) start();
