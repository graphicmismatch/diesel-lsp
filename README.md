# diesel-lsp

A language server for **Diesel**, the C-like text format used by the
[Petroleum](https://github.com/graphicmismatch/Petroleum) synthesizer for patches
(`.dsl` files).

It has **no dependencies**: the lexer and parser mirror Petroleum's own
`Serialization/Diesel.java`, and the LSP wire protocol is a few dozen lines of framing.
Clone it, point your editor at `bin/diesel-lsp.js`, done - there is no install step.

## Features

| Feature | What you get |
| --- | --- |
| Diagnostics | Syntax errors, unknown node types and ports, duplicate node names, unknown references, an input driven twice, missing/duplicate `Audio Out`, macros not pointing at a `Constant` |
| Completion | Node types (quoted when they need it), a node's ports after `.` - outputs before `->`, inputs after it - port values and fields inside a node body, waveform names inside an `Oscillator` |
| Hover | A node type's full port list with defaults; the port under the cursor with its default |
| Go to definition | From a connection end or a macro target to the node declaration |
| Document symbols | The patch, its nodes (with types), its macros, and nested subpatches |
| Rename | A node name and every reference to it |

Every diagnostic mirrors a rule Petroleum itself enforces when loading or building a
patch, so a clean file really does load. Where a node's ports depend on a construction
argument (`Tracker`, `Piano Roll`, `Granular Player`, `Instrument`, `Patch`,
`Oscillator`, or anything with an arity field like `ports`/`steps`/`channels`), port
checking is skipped rather than guessed at.

## Usage

```sh
node bin/diesel-lsp.js      # speaks LSP over stdio
npm test                    # 28 tests, no dependencies
```

### Neovim

```lua
vim.filetype.add({ extension = { dsl = 'diesel' } })

vim.api.nvim_create_autocmd('FileType', {
  pattern = 'diesel',
  callback = function(args)
    vim.lsp.start({
      name = 'diesel-lsp',
      cmd = { 'node', '/path/to/diesel-lsp/bin/diesel-lsp.js' },
      root_dir = vim.fs.dirname(args.file),
    })
  end,
})
```

### VS Code

There is no extension here yet; any generic LSP bridge (for example
`vscode-generic-lsp`) can launch `node bin/diesel-lsp.js` for files matching `*.dsl`.

### Helix

```toml
# languages.toml
[language-server.diesel-lsp]
command = "node"
args = ["/path/to/diesel-lsp/bin/diesel-lsp.js"]

[[language]]
name = "diesel"
scope = "source.diesel"
file-types = ["dsl"]
comment-token = "//"
language-servers = ["diesel-lsp"]
```

## Syntax highlighting

This server deliberately provides no semantic tokens. Highlighting comes from the
tree-sitter grammar in [diesel-treesitter](../diesel-treesitter).

## The node catalog

`data/nodes.json` lists every node type with its input ports (and their defaults) and
output ports. It is generated from Petroleum itself, so it can never drift from a guess:

```sh
cd /path/to/Petroleum
mvn -o compile
javac -cp target/classes -d /tmp/catalog /path/to/diesel-lsp/tools/Catalog.java
java -cp target/classes:/tmp/catalog Catalog > /path/to/diesel-lsp/data/nodes.json
```

Regenerate it whenever Petroleum gains node types or changes ports.

## Layout

```
bin/diesel-lsp.js   executable entry point
src/lexer.js        tokenizer, mirrors Diesel.java's Lexer
src/parser.js       recursive-descent parser with error recovery
src/analyze.js      semantic diagnostics
src/catalog.js      node/port lookup over data/nodes.json
src/features.js     completion, hover, definition, symbols, rename
src/server.js       LSP framing, document store, request routing
data/nodes.json     generated node catalog
examples/*.dsl      real patches written by Petroleum, used as tests
tools/Catalog.java  the generator for data/nodes.json
```

## Not included

- Formatting (`textDocument/formatting`) - Petroleum's own writer is the formatter;
  round-tripping a patch through `petroleum render` normalises it.
- Workspace-wide features: a `.dsl` file is self-contained, so there is nothing to index
  across files.
- Incremental sync: documents are re-parsed in full on each change. Patch files are
  small, and a full parse of the largest example here takes well under a millisecond.

## Licence

MIT.
