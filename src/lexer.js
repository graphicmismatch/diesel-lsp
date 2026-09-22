'use strict';

// Token kinds mirror Diesel.java's Lexer: IDENT, STRING, NUMBER, BLOB, PUNCT, END.
const PUNCT = '{}()[];,=.';

function isLetter(c) {
  return /[A-Za-z_]/.test(c);
}

function isLetterOrDigit(c) {
  return /[A-Za-z0-9_]/.test(c);
}

function isDigit(c) {
  return c >= '0' && c <= '9';
}

function isNumberChar(c, previous) {
  return isDigit(c) || c === '.' || c === 'e' || c === 'E'
    || ((c === '-' || c === '+') && (previous === 'e' || previous === 'E'));
}

/**
 * Tokenizes Diesel source. Never throws: anything the Java lexer would reject is
 * reported in `errors` and the offending character is skipped, so an editor keeps
 * getting a usable token stream while the user is mid-keystroke.
 */
function tokenize(text) {
  const tokens = [];
  const errors = [];
  let index = 0;
  let line = 0;
  let lineStart = 0;

  const at = () => ({ line, character: index - lineStart });
  const newline = () => {
    index++;
    line++;
    lineStart = index;
  };
  const push = (kind, value, start, raw) => {
    tokens.push({ kind, value, raw: raw === undefined ? value : raw, start, end: at() });
  };
  const fail = (message, start, end) => errors.push({ message, range: { start, end: end || at() } });

  const skipBlank = () => {
    while (index < text.length) {
      const c = text[index];
      if (c === '\n') {
        newline();
      } else if (/\s/.test(c)) {
        index++;
      } else if (text.startsWith('//', index)) {
        while (index < text.length && text[index] !== '\n') index++;
      } else if (text.startsWith('/*', index)) {
        const start = at();
        const end = text.indexOf('*/', index + 2);
        if (end < 0) {
          fail('Unterminated /* comment', start, { line, character: index - lineStart });
          index = text.length;
          return;
        }
        while (index < end + 2) {
          if (text[index] === '\n') newline();
          else index++;
        }
      } else {
        return;
      }
    }
  };

  const readString = () => {
    const start = at();
    const from = index;
    let out = '';
    index++;
    for (;;) {
      if (index >= text.length) {
        fail('Unterminated string', start);
        return { value: out, start, raw: text.slice(from, index) };
      }
      const c = text[index];
      if (c === '"') {
        index++;
        return { value: out, start, raw: text.slice(from, index) };
      }
      if (c === '\n') {
        out += c;
        newline();
        continue;
      }
      index++;
      if (c !== '\\') {
        out += c;
        continue;
      }
      if (index >= text.length) continue;
      const escape = text[index++];
      switch (escape) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'u': {
          if (index + 4 > text.length) {
            fail('Bad \\u escape', start);
            break;
          }
          out += String.fromCharCode(parseInt(text.slice(index, index + 4), 16));
          index += 4;
          break;
        }
        default: out += escape;
      }
    }
  };

  for (;;) {
    skipBlank();
    if (index >= text.length) {
      push('END', 'end of file', at());
      return { tokens, errors };
    }
    const start = at();
    const from = index;
    const c = text[index];
    if (c === 'b' && text.startsWith('b64"', index)) {
      index += 3;
      const string = readString();
      push('BLOB', string.value, start, text.slice(from, index));
    } else if (isLetter(c)) {
      while (index < text.length && isLetterOrDigit(text[index])) index++;
      push('IDENT', text.slice(from, index), start);
    } else if (c === '"') {
      const string = readString();
      push('STRING', string.value, start, string.raw);
    } else if (isDigit(c)
      || (c === '-' && index + 1 < text.length && (isDigit(text[index + 1]) || text[index + 1] === '.'))
      || (c === '.' && index + 1 < text.length && isDigit(text[index + 1]))) {
      index++;
      while (index < text.length && isNumberChar(text[index], text[index - 1])) index++;
      push('NUMBER', text.slice(from, index), start);
    } else if (text.startsWith('->', index)) {
      index += 2;
      push('PUNCT', '->', start);
    } else if (PUNCT.includes(c)) {
      index++;
      push('PUNCT', c, start);
    } else {
      index++;
      fail(`Unexpected character '${c}'`, start);
    }
  }
}

module.exports = { tokenize };
