# Dual Publishing Guide

Vibe Code Guardian now supports dual publishing to both VS Code Marketplace and Zed.dev ecosystem.

## Overview

The project publishes two extensions simultaneously:
- **VS Code Extension**: Published to Visual Studio Code Marketplace
- **Zed Extension**: Published to crates.io for Zed editor users

## Build and Publish Workflow

### Build Commands

```bash
# Basic build (no publishing)
./scripts/build.sh build

# Create package only
./scripts/build.sh package
```

### Publishing Commands

```bash
# Publish to both VS Code Marketplace and Zed
./scripts/build.sh publish

# Publish to VS Code only (skip Zed)
./scripts/build.sh publish --skip-zed

# Full release with version bump
./scripts/build.sh full patch    # 0.1.23 -> 0.1.24
./scripts/build.sh full minor    # 0.1.23 -> 0.2.0
./scripts/build.sh full major    # 0.1.23 -> 1.0.0
```

## Publishing Process

When you run `./scripts/build.sh publish`, the following happens:

1. **Build Phase**
   - Type checking
   - Linting
   - Bundling with esbuild

2. **Package Phase**
   - Creates `.vsix` package for VS Code

3. **Publish Phase - Zed Extension**
   - Updates version in `zed/extension.toml`
   - Builds Zed extension with Cargo
   - Publishes to crates.io (if available)
   - Commits and pushes version updates to zed repository

4. **Publish Phase - VS Code Extension**
   - Publishes to VS Code Marketplace using vsce
   - Creates GitHub tag
   - Pushes to main repository

5. **Post-Publish**
   - Displays installation instructions for both platforms

## Required Tools

For full dual publishing, ensure you have:

- **Node.js** & **npm**: For VS Code extension development
- **cargo**: For Zed extension building and publishing
- **vsce**: VS Code Extension Manager (`npm install -g @vscode/vsce`)
- **git**: For version control

## Configuration

### VS Code Extension (`package.json`)

```json
{
  "name": "vibe-code-guardian",
  "version": "0.1.24",
  "publisher": "vibe-coder",
  ...
}
```

### Zed Extension (`zed/extension.toml`)

```toml
id = "vibe-code-guardian"
name = "Vibe Code Guardian"
version = "0.1.24"
schema_version = 1
authors = ["Vibe Coder <vibe@coder.dev>"]
description = "Game-like checkpoint system for AI-assisted coding"
repository = "https://github.com/aresnasa/vibe-code-guardian"
```

## Installation

### VS Code

```bash
# Install from VS Code Marketplace
# Search for "Vibe Code Guardian" in Extensions
# Or: code --install-extension vibe-coder.vibe-code-guardian
```

### Zed

```bash
# Install via Zed CLI
zed extensions install vibe-code-guardian

# Or manually add to settings.json
{
  "extensions": {
    "vibe-code-guardian": {
      "version": "0.1.24"
    }
  }
}
```

## Version Management

- VS Code and Zed extensions maintain synchronized versions
- Version is defined in root `package.json`
- Publishing automatically updates both platforms
- Git tags follow `v{version}` format

## Troubleshooting

### Cargo publish fails

If `cargo publish` fails, you may need to:
1. Log in to crates.io: `cargo login`
2. Ensure your `Cargo.toml` has the correct package name
3. Check that the version doesn't already exist on crates.io

### Skip Zed publishing

If you only want to publish to VS Code:
```bash
./scripts/build.sh publish --skip-zed
```

### Test before publishing

Run the test suite to verify everything works:
```bash
./scripts/test-dual-publish.sh
```

## Continuous Integration

The dual publishing workflow is designed to work with CI/CD pipelines:

```bash
# In CI environment
./scripts/build.sh full patch --skip-zed  # Skip interactive prompts
```

## Resources

- VS Code Marketplace: https://marketplace.visualstudio.com/
- crates.io (Zed): https://crates.io/
- Zed Extensions: https://zed.dev/extensions
- Project Repository: https://github.com/aresnasa/vibe-code-guardian
