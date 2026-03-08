# Publishing Guide

Vibe Code Guardian publishes to **two platforms** simultaneously — the process is fully automated by `scripts/build.sh`.

| Platform | Registry | Install |
|----------|----------|---------|
| VS Code | [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian) | `code --install-extension vibe-coder.vibe-code-guardian` |
| Zed | [zed.dev/extensions](https://zed.dev/extensions?query=vibe-code-guardian) | Search "Vibe Code Guardian" in Zed Extensions panel |

---

## Quick Start

```bash
# Publish current version to both platforms
./scripts/build.sh publish

# Bump version + publish
./scripts/build.sh full patch    # 0.6.0 → 0.6.1
./scripts/build.sh full minor    # 0.6.0 → 0.7.0
./scripts/build.sh full major    # 0.6.0 → 1.0.0

# Publish to VS Code only
./scripts/build.sh publish --skip-zed

# Publish to Zed only
./scripts/build.sh publish --skip-vscode

# Dry run (simulate without uploading)
./scripts/build.sh publish --dry-run
```

---

## What `publish` Does

The script executes these steps in order:

### 1. Build Phase
- Type checking (`tsc`)
- Linting (`eslint`)
- Bundling (`esbuild` → `dist/extension.js`)

### 2. Package Phase
- Creates `.vsix` package via `vsce`

### 3. Zed Publish Phase
1. **Update version** in `zed/extension.toml` and `zed/Cargo.toml`
2. **Build WASM** — `cargo build --target wasm32-wasip1 --release` to verify compilation
3. **Push submodule** — push `zed/` to `aresnasa/vibe-code-guardian-zed`
4. **Clone fork** — clone `aresnasa/extensions` (fork of `zed-industries/extensions`)
5. **Update pointer** — update submodule commit + `extensions.toml` version
6. **Create PR** — open PR to `zed-industries/extensions` via `gh` CLI
7. Once the PR is merged by Zed maintainers, the extension appears on zed.dev

### 4. VS Code Publish Phase
- Publishes `.vsix` to Marketplace via `vsce publish`

### 5. Git Phase
- Commits all changes
- Creates git tag `v{version}`
- Pushes to `origin/main`

---

## Prerequisites

### Required Tools

| Tool | Purpose | Install |
|------|---------|---------|
| `node` / `npm` | Build & package | [nodejs.org](https://nodejs.org) |
| `cargo` / `rustup` | Zed WASM build | [rustup.rs](https://rustup.rs) |
| `gh` | Zed PR automation | `brew install gh` then `gh auth login` |
| `vsce` | VS Code packaging | `npm install -g @vscode/vsce` (auto-installed) |

### Authentication

#### VS Code Marketplace PAT

```bash
# Option 1: Environment variable (recommended for CI)
export VSCE_PAT='your_token_here'

# Option 2: Interactive — the script will prompt you
./scripts/build.sh publish
```

To create a PAT:
1. Visit [marketplace.visualstudio.com/manage/publishers/vibe-coder](https://marketplace.visualstudio.com/manage/publishers/vibe-coder)
2. Create a PAT with **Marketplace → Manage** scope

#### GitHub CLI (for Zed publishing)

```bash
gh auth login
# Follow the prompts to authenticate
```

---

## Version Management

Versions are synchronized across all files automatically:

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `zed/extension.toml` | `version` |
| `zed/Cargo.toml` | `version` under `[package]` |
| `extensions.toml` (in fork) | `version` under `[vibe-code-guardian]` |

The `full` mode bumps `package.json` first, then the publish flow propagates the version everywhere else.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  aresnasa/vibe-code-guardian  (main repo)        │
│  ├── package.json         ← VS Code extension   │
│  ├── src/                 ← TypeScript source    │
│  ├── dist/extension.js    ← bundled output       │
│  └── zed/                 ← git submodule ──────┐│
└─────────────────────────────────────────────────┘│
                                                    │
┌───────────────────────────────────────────────────┘
│  aresnasa/vibe-code-guardian-zed  (submodule repo)
│  ├── extension.toml
│  ├── Cargo.toml
│  └── src/lib.rs           ← Rust → WASM
└───────────────────────────────────────────────────
                      │
                      ▼  (added as submodule)
┌───────────────────────────────────────────────────
│  zed-industries/extensions  (PR target)
│  ├── extensions.toml      ← version registry
│  └── extensions/vibe-code-guardian/  ← submodule
└───────────────────────────────────────────────────
```

---

## Troubleshooting

### VS Code Marketplace

| Error | Solution |
|-------|----------|
| `Authentication failed` | Regenerate PAT; ensure **Marketplace → Manage** scope |
| `Version already exists` | Bump version: `./scripts/build.sh full patch` |
| `Request timeout` | Retry, or upload `.vsix` manually at the [publisher dashboard](https://marketplace.visualstudio.com/manage/publishers/vibe-coder) |

### Zed

| Error | Solution |
|-------|----------|
| `gh: not logged in` | Run `gh auth login` |
| `wasm32-wasip1 not installed` | Script auto-installs; or run `rustup target add wasm32-wasip1` |
| `PR already exists` | Close the old PR or reuse the branch |
| `pnpm sort-extensions failed` | Non-fatal; sorting is optional |

### Manual VS Code Upload

If the API is unreachable, upload the `.vsix` file directly:

1. Visit [marketplace.visualstudio.com/manage/publishers/vibe-coder](https://marketplace.visualstudio.com/manage/publishers/vibe-coder)
2. Click **Update** on "Vibe Code Guardian"
3. Upload `vibe-code-guardian-{version}.vsix`

---

## Post-Publish Checklist

- [ ] VS Code Marketplace shows the new version
- [ ] Git tag `v{version}` pushed to GitHub
- [ ] Zed PR created (check [zed-industries/extensions PRs](https://github.com/zed-industries/extensions/pulls))
- [ ] Test install in VS Code: `code --install-extension vibe-coder.vibe-code-guardian`
- [ ] Test install in Zed after PR merge