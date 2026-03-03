# 🎮 Vibe Code Guardian

Game-like checkpoint system for AI-assisted coding sessions. Save, load, and rollback your code like game saves!

## Features

- **💾 Quick Save** - Create checkpoints with one keystroke
- **⏰ Auto Save** - Automatic periodic checkpoints
- **🤖 AI Detection** - Auto-checkpoint when Copilot/Claude makes changes
- **⏪ Rollback** - Restore code to any checkpoint instantly
- **📊 Diff View** - See what changed since any checkpoint
- **🎮 Sessions** - Organize checkpoints by coding session

## Available On

- **VS Code**: [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian)
- **Zed**: [crates.io](https://crates.io/crates/vibe-code-guardian)

## Keyboard Shortcuts

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Quick Save | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| Create Checkpoint | `Ctrl+Alt+S` | `Cmd+Alt+S` |
| Rollback | `Ctrl+Alt+Z` | `Cmd+Alt+Z` |

## Commands

Open Command Palette (`Ctrl+Shift+P`) and type "Vibe Guardian":

- **Create Checkpoint** - Save current state with description
- **Quick Save** - Fast checkpoint without prompt
- **Rollback to Checkpoint** - Restore to selected checkpoint
- **View Changes** - Show diff from checkpoint
- **Start/End Session** - Manage coding sessions

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `autoSaveEnabled` | `true` | Enable auto checkpoints |
| `autoSaveIntervalMinutes` | `5` | Minutes between auto-saves |
| `autoCheckpointOnAIChanges` | `true` | Checkpoint on AI edits |
| `maxCheckpointsPerSession` | `50` | Max checkpoints per session |

## Requirements

- Git repository (recommended for full functionality)
- **VS Code**: 1.107.0 or higher
- **Zed**: Latest version with extension support

## License

MIT
