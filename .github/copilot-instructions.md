# Vibe Code Guardian - VS Code & Zed Extension

A game-like checkpoint/save system for AI-assisted coding (vibe coding).

## Features
- Automatic checkpoint creation when AI tools make edits
- Manual checkpoint with custom names (like game save slots)
- Visual timeline view of all checkpoints
- One-click rollback to any checkpoint
- Diff preview before rollback
- Git integration for version control
- Status bar with checkpoint info
- Keyboard shortcuts for quick save/load

## Tech Stack
- TypeScript + VS Code Extension API
- Rust → WebAssembly (Zed extension, in `zed/` submodule)
- Git integration via simple-git
- Bundled with esbuild

## Project Structure
- `src/` — TypeScript source (VS Code extension)
- `zed/` — Zed extension (git submodule → aresnasa/vibe-code-guardian-zed)
- `scripts/` — All shell scripts (build, test, publish)
- `docs/` — All documentation except README.md and CHANGELOG.md
- `images/` — Extension icons and assets
- `dist/` — Bundled output (gitignored)

## Development
- Run `npm install` to install dependencies
- Press F5 to launch Extension Development Host
- Use `./scripts/build.sh build` to compile
- Use `./scripts/build.sh package` to create .vsix
- Use `./scripts/build.sh publish` to publish to VS Code + Zed
- See `docs/development.md` for the full guide

## Documentation
- `docs/publishing.md` — VS Code Marketplace + Zed publish flow
- `docs/development.md` — Dev setup, project structure, debugging
- `docs/hard-reset.md` — --hard flag backup/restore
- `docs/notification-system.md` — Smart notification throttling
- `docs/testing.md` — Manual test matrix (20 cases)

## Conventions
- All `.md` files go in `docs/` (except README.md, CHANGELOG.md, LICENSE)
- All `.sh` files go in `scripts/`
- Never hardcode API keys or tokens — use environment variables
- Claude.md is in `.gitignore` and must never be committed