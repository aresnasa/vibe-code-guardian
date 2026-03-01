# Development Guide for Vibe Guardian Zed Extension

## Local Development

This extension uses `zed_extension_api` which is provided by Zed when installed as a dev extension.

### Prerequisites

1. **Install Rust via rustup** (required for dev extensions)
   ```bash
   curl --proto '=https' sh.rustup.rs | sh
   source "$HOME/.cargo/env"
   ```

2. **Install Zed** (latest version)

### Install as Dev Extension

**Option 1: Via Zed UI**
1. Open Zed
2. Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
3. Type "dev" and select "Install Dev Extension"
4. Navigate to this project directory
5. Zed will load the extension

**Option 2: Via Command Line**
```bash
zed install dev extension /path/to/vibe-guardian-zed
```

### Running Tests

Start Zed with verbose logging:
```bash
zed --foreground
```

Check logs for errors:
```bash
zed: open log
```

## Publishing to Zed Extension Registry

### Step 1: Fork the Extensions Repository

1. Fork `zed-industries/extensions` to your GitHub account
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/extensions.git
   cd extensions
   ```

### Step 2: Add Your Extension as Submodule

Add this extension as a Git submodule:
```bash
git submodule add https://github.com/aresnasa/vibe-guardian-zed.git extensions/vibe-guardian
git add extensions/vibe-guardian
```

### Step 3: Update extensions.toml

Add your extension to the top-level `extensions.toml`:
```toml
[vibe-guardian]
submodule = "extensions/vibe-guardian"
version = "0.1.0"
```

### Step 4: Create Pull Request

1. Commit your changes:
   ```bash
   git commit -m "Add vibe-guardian extension"
   ```

2. Push to your fork:
   ```bash
   git push origin main
   ```

3. Create PR to `zed-industries/extensions`:
   - Target: `main` branch
   - Title: "Add Vibe Guardian extension"
   - Describe the extension and its features

### Step 5: Wait for Merge

The Zed team will review your PR and, if approved, merge it. After merging:
- The extension will be automatically packaged
- Published to the Zed extension registry
- Available in Zed's Extensions panel

## Extension ID Guidelines

- Your extension ID must be unique
- Don't use "zed" or "Zed" in your extension ID or name
- The ID should be lowercase with hyphens

## License

This extension uses MIT License, which is one of the accepted licenses for Zed extensions.

## Troubleshooting

### Extension not loading
1. Check `zed: open log` for errors
2. Ensure all required fields in `extension.toml` are correct
3. Verify `zed_extension_api` version compatibility

### Build errors
1. Run `cargo check` to verify compilation
2. Check Rust version: `rustc --version` (must be from rustup)
