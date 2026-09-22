'use strict';

const { tokenize } = require('./lexer');

// Mirrors Diesel.java's Reader, but recovers from errors instead of throwing on
// the first one: an editor needs every problem in the file, and a half-typed
// line must not blank out the rest of the outline.
class Parser {
  constructor(text) {
    const { tokens, errors } = tokenize(text);
    this.tokens = tokens;
    this.diagnostics = errors.map(error => ({ ...error, severity: 1 }));
    this.position = 0;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)];
  }

  next() {
    const token = this.peek();
    if (token.kind !== 'END') this.position++;
    return token;
  }

  atEnd() {
    return this.peek().kind === 'END';
  }

  is(token, value) {
    return (token.kind === 'PUNCT' || token.kind === 'IDENT') && token.value === value;
  }

  error(token, message) {
    this.diagnostics.push({ message, range: { start: token.start, end: token.end }, severity: 1 });
  }

  expectPunct(value) {
    const token = this.peek();
    if (token.kind === 'PUNCT' && token.value === value) return this.next();
    this.error(token, `Expected '${value}', found '${token.value}'`);
    return null;
  }

  expect(kind, what) {
    const token = this.peek();
    if (token.kind === kind) return this.next();
    this.error(token, `Expected ${what}, found '${token.value}'`);
    return null;
  }

  // Skips to just past the next ';' or to a '}'/'{' boundary, so one bad
  // statement costs one statement rather than the rest of the patch.
  recover() {
    let depth = 0;
    while (!this.atEnd()) {
      const token = this.peek();
      if (this.is(token, '{')) depth++;
      if (this.is(token, '}')) {
        if (depth === 0) return;
        depth--;
      }
      this.next();
      if (this.is(token, ';') && depth === 0) return;
    }
  }

  file() {
    const items = [];
    let patch = null;
    while (!this.atEnd()) {
      const token = this.peek();
      if (this.is(token, 'patch')) {
        this.next();
        const parsed = this.document(token.start);
        if (patch) this.error(token, 'A Diesel file holds exactly one top-level patch');
        else patch = parsed;
        items.push(parsed);
      } else if (this.is(token, 'sample') || this.is(token, 'data')) {
        this.next();
        const id = this.expect('IDENT', 'a blob id');
        this.expectPunct('=');
        const blob = this.expect('BLOB', 'a b64"..." literal');
        this.expectPunct(';');
        items.push({
          kind: 'blob',
          blobKind: token.value,
          id: id ? id.value : null,
          idRange: id ? { start: id.start, end: id.end } : null,
          range: { start: token.start, end: (blob || id || token).end },
        });
      } else {
        this.error(token, `Expected 'patch', 'sample' or 'data', found '${token.value}'`);
        this.next();
        this.recover();
      }
    }
    if (!patch && this.diagnostics.length === 0) {
      this.diagnostics.push({
        message: "Missing top-level 'patch { ... }'",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        severity: 1,
      });
    }
    return { kind: 'file', items, patch, diagnostics: this.diagnostics };
  }

  document(start) {
    const patch = {
      kind: 'patch',
      name: null,
      nameRange: null,
      nodes: [],
      connections: [],
      macros: [],
      fields: [],
      range: { start, end: start },
      bodyRange: null,
    };
    if (this.peek().kind === 'STRING') {
      const name = this.next();
      patch.name = name.value;
      patch.nameRange = { start: name.start, end: name.end };
    }
    const open = this.expectPunct('{');
    if (!open) {
      patch.range.end = this.peek().end;
      return patch;
    }
    while (!this.atEnd() && !this.is(this.peek(), '}')) {
      const before = this.position;
      const token = this.peek();
      const after = this.peek(1);
      if (this.is(token, 'macro') && after.kind === 'STRING') {
        patch.macros.push(this.macro());
      } else if (token.kind === 'STRING' || (token.kind === 'IDENT' && after.kind === 'IDENT')) {
        patch.nodes.push(this.node());
      } else if (token.kind === 'IDENT' && this.is(after, '=')) {
        patch.fields.push(this.field());
      } else if (token.kind === 'IDENT' && this.is(after, '.')) {
        patch.connections.push(this.connection());
      } else {
        this.error(token, `Expected a node declaration, connection, macro or assignment, found '${token.value}'`);
        this.next();
        this.recover();
      }
      if (this.position === before) this.next();
    }
    const close = this.peek();
    if (this.is(close, '}')) this.next();
    patch.bodyRange = { start: open.start, end: close.end };
    patch.range = { start, end: close.end };
    return patch;
  }

  macro() {
    const start = this.next().start;
    const name = this.next();
    this.expectPunct('->');
    const target = this.expect('IDENT', 'a node name');
    this.expectPunct('(');
    const min = this.expect('NUMBER', 'a number');
    this.expectPunct(',');
    const max = this.expect('NUMBER', 'a number');
    const close = this.expectPunct(')');
    this.expectPunct(';');
    return {
      kind: 'macro',
      name: name.value,
      nameRange: { start: name.start, end: name.end },
      target: target ? target.value : null,
      targetRange: target ? { start: target.start, end: target.end } : null,
      min: min ? Number(min.value) : null,
      max: max ? Number(max.value) : null,
      minRange: min ? { start: min.start, end: min.end } : null,
      range: { start, end: (close || name).end },
    };
  }

  node() {
    const typeToken = this.next();
    const nameToken = this.expect('IDENT', 'a node name');
    const node = {
      kind: 'node',
      type: typeToken.value,
      typeRange: { start: typeToken.start, end: typeToken.end },
      name: nameToken ? nameToken.value : null,
      nameRange: nameToken ? { start: nameToken.start, end: nameToken.end } : null,
      fields: [],
      portValues: [],
      range: { start: typeToken.start, end: (nameToken || typeToken).end },
      bodyRange: null,
    };
    if (this.is(this.peek(), ';')) {
      node.range.end = this.next().end;
      return node;
    }
    const open = this.peek();
    if (!this.is(open, '{')) {
      this.error(open, `Expected ';' or '{' after node '${node.name}', found '${open.value}'`);
      this.recover();
      return node;
    }
    this.next();
    while (!this.atEnd() && !this.is(this.peek(), '}')) {
      const before = this.position;
      if (this.is(this.peek(), '.')) {
        const dot = this.next();
        const port = this.name();
        this.expectPunct('=');
        const value = this.expect('NUMBER', 'a number');
        const end = this.expectPunct(';');
        node.portValues.push({
          port: port ? port.value : null,
          portRange: port ? { start: port.start, end: port.end } : null,
          value: value ? Number(value.value) : null,
          range: { start: dot.start, end: (end || value || dot).end },
        });
      } else {
        const keyToken = this.peek();
        const field = this.field();
        if (field && ['id', 'type', 'portValues'].includes(field.key)) {
          this.error(keyToken, `'${field.key}' cannot be assigned inside a node body`);
        }
        if (field) node.fields.push(field);
      }
      if (this.position === before) this.next();
    }
    const close = this.peek();
    if (this.is(close, '}')) this.next();
    node.bodyRange = { start: open.start, end: close.end };
    node.range = { start: typeToken.start, end: close.end };
    if (this.is(this.peek(), ';')) node.range.end = this.next().end;
    return node;
  }

  connection() {
    const from = this.portRef();
    this.expectPunct('->');
    const to = this.portRef();
    const end = this.expectPunct(';');
    return {
      kind: 'connection',
      from,
      to,
      range: { start: from.range.start, end: (end || to.range).end || to.range.end },
    };
  }

  portRef() {
    const node = this.expect('IDENT', 'a node name');
    this.expectPunct('.');
    const port = this.name();
    const start = node ? node.start : this.peek().start;
    const end = port ? port.end : (node ? node.end : start);
    return {
      node: node ? node.value : null,
      nodeRange: node ? { start: node.start, end: node.end } : null,
      port: port ? port.value : null,
      portRange: port ? { start: port.start, end: port.end } : null,
      range: { start, end },
    };
  }

  field() {
    const keyToken = this.name();
    if (!keyToken) {
      this.recover();
      return null;
    }
    this.expectPunct('=');
    const value = this.value();
    const end = this.expectPunct(';');
    return {
      kind: 'field',
      key: keyToken.value,
      keyRange: { start: keyToken.start, end: keyToken.end },
      value,
      range: { start: keyToken.start, end: (end || keyToken).end },
    };
  }

  name() {
    const token = this.peek();
    if (token.kind === 'IDENT' || token.kind === 'STRING') return this.next();
    this.error(token, `Expected a name, found '${token.value}'`);
    return null;
  }

  value() {
    const token = this.next();
    switch (token.kind) {
      case 'NUMBER':
        return { type: 'number', value: Number(token.value), range: { start: token.start, end: token.end } };
      case 'STRING':
        return { type: 'string', value: token.value, range: { start: token.start, end: token.end } };
      case 'BLOB':
        return { type: 'blob', value: token.value, range: { start: token.start, end: token.end } };
      case 'IDENT': {
        if (token.value === 'patch') {
          const nested = this.document(token.start);
          return { type: 'patch', value: nested, range: nested.range };
        }
        if (token.value === 'true' || token.value === 'false') {
          return { type: 'boolean', value: token.value === 'true', range: { start: token.start, end: token.end } };
        }
        return { type: 'identifier', value: token.value, range: { start: token.start, end: token.end } };
      }
      default:
        break;
    }
    if (this.is(token, '{')) {
      const entries = [];
      while (!this.atEnd() && !this.is(this.peek(), '}')) {
        const before = this.position;
        const key = this.name();
        this.expectPunct('=');
        const value = this.value();
        if (key) {
          entries.push({ key: key.value, keyRange: { start: key.start, end: key.end }, value });
        }
        if (!this.is(this.peek(), '}')) this.expectPunct(',');
        if (this.position === before) this.next();
      }
      const close = this.peek();
      if (this.is(close, '}')) this.next();
      return { type: 'object', entries, range: { start: token.start, end: close.end } };
    }
    if (this.is(token, '[')) {
      const items = [];
      while (!this.atEnd() && !this.is(this.peek(), ']')) {
        const before = this.position;
        items.push(this.value());
        if (!this.is(this.peek(), ']')) this.expectPunct(',');
        if (this.position === before) this.next();
      }
      const close = this.peek();
      if (this.is(close, ']')) this.next();
      return { type: 'array', items, range: { start: token.start, end: close.end } };
    }
    this.error(token, `Expected a value, found '${token.value}'`);
    return { type: 'error', value: null, range: { start: token.start, end: token.end } };
  }
}

function parse(text) {
  return new Parser(text).file();
}

module.exports = { parse };
