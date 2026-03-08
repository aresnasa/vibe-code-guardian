# Development Guide

This document covers how to set up, build, test, and debug the Vibe Code Guardian extension locally.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 18 | Runtime & build |
| npm | ≥ 9 | Package management |
| Git | any | Version control |
| Rust / Cargo | latest stable | Zed extension build |
| VS Code | ≥ 1.107.0 | Extension host |

Optional but recommended VS Code extensions:

- `amodio.tsl-problem-matcher`
- `ms-vscode.extension-test-runner`
- `dbaeumer.vscode-eslint`

---

## Project Structure

```
vibe-code-guardian/
├── src/                    # TypeScript source
│   ├── extension.ts        # Entry point (activate / deactivate)
│   ├── checkpointManager.ts
│   ├── gitService.ts
│   ├── timelineProvider.ts
│   └── test/               # Unit / integration tests
├── zed/                    # Zed extension (git submodule)
│   ├── extension.toml
│   ├── Cargo.toml
│   └── src/lib.rs          # Rust → WASM
├── scripts/                # Build, test & publish scripts
│   └── build.sh            # Unified build & publish
├── docs/                   # All documentation (except README)
├── images/                 # Icons & assets
├── dist/                   # Bundled output (gitignored)
├── package.json            # VS Code extension manifest
├── esbuild.js              # Bundler config
├── tsconfig.json
└── eslint.config.mjs
```

---

## Getting Started

```bash
# Clone with submodules
git clone --recurse-submodules https://github.com/aresnasa/vibe-code-guardian.git
cd vibe-code-guardian

# Install dependencies
npm install
```

---

## Building

```bash
# Type-check + lint + bundle (recommended)
./scripts/build.sh build

# Or run steps individually:
npm run check-types      # TypeScript type checking
npm run lint             # ESLint
node esbuild.js          # Bundle → dist/extension.js
```

The bundled output lands in `dist/extension.js`.

---

## Running & Debugging

1. Open the project in VS Code.
2. Press **F5** to launch the **Extension Development Host**.
3. The extension activates automatically in the new window.
4. Set breakpoints in `src/` — the debugger attaches to the extension host.
5. Use the **Debug Console** to inspect output.

To reload after code changes:
- Click the restart button in the debug toolbar, **or**
- Press `Cmd+R` / `Ctrl+R` in the Extension Development Host window.

---

## Testing

### Automated tests

```bash
# Compile and run tests
npm run pretest
npm run test
```

Tests live in `src/test/` and match the pattern `**/*.test.ts`.

### Manual test scripts

All test scripts are in `scripts/`:

| Script | Purpose |
|--------|---------|
| `scripts/run-tests.sh` | Run the full automated test suite |
| `scripts/test-hard-reset.sh` | Verify `--hard` backup & reset |
| `scripts/verify-hard-reset.sh` | Validate hard-reset implementation |
| `scripts/test-rollback-demo.sh` | End-to-end rollback scenario |
| `scripts/test-publish-flow.sh` | Simulate publish without uploading |
| `scripts/test-publish.sh` | Dual-platform publish prerequisites |
| `scripts/test-vsce-auth.sh` | VS Code Marketplace auth check |
| `scripts/test-dual-publish.sh` | Full dual-publish dry run |

### Manual test cases

See [docs/testing.md](testing.md) for the complete manual test matrix (20 cases + performance + error handling).

---

## Packaging

```bash
# Build + create .vsix
./scripts/build.sh package

# The .vsix file appears in the project root:
#   vibe-code-guardian-{version}.vsix
```

---

## Publishing

See [docs/publishing.md](publishing.md) for the full guide. Quick version:

```bash
# Publish to VS Code Marketplace + Zed
./scripts/build.sh publish

# Bump version and publish
./scripts/build.sh full patch
```

---

## Zed Extension Development

The Zed extension lives in `zed/` (a git submodule pointing to `aresnasa/vibe-code-guardian-zed`).

```bash
# Build for wasm
cd zed
rustup target add wasm32-wasip1    # first time only
cargo build --target wasm32-wasip1 --release

# Install as dev extension in Zed
# In Zed: Cmd+Shift+P → "zed: install dev extension" → select the zed/ directory
```

---

## Code Style

- **Language**: TypeScript (strict mode)
- **Bundler**: esbuild
- **Linter**: ESLint via `eslint.config.mjs`
- **Formatting**: follow existing patterns; no Prettier config currently

---

## Exploring the VS Code API

Open `node_modules/@types/vscode/index.d.ts` for the full API surface. Key APIs used by this extension:

- `vscode.commands.registerCommand`
- `vscode.window.createTreeView`
- `vscode.workspace.onDidSaveTextDocument`
- `vscode.scm` (Source Control API)
- `vscode.window.showInformationMessage`

---

## Useful Links

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Zed Extension Docs](https://zed.dev/docs/extensions/developing-extensions)
- [simple-git (npm)](https://www.npmjs.com/package/simple-git)