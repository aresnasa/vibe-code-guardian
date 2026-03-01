# 🎮 Vibe Code Guardian for Zed

Game-like checkpoint system for AI-assisted coding sessions. Save, load, and rollback your code like game saves!

## Features

- **💾 Quick Save** - Create checkpoints with one keystroke
- **⏰ Auto Save** - Automatic periodic checkpoints
- **🤖 AI Detection** - Auto-checkpoint when AI makes changes
- **⏪ Rollback** - Restore code to any checkpoint instantly
- **📊 Diff View** - See what changed since any checkpoint
- **🎮 Sessions** - Organize checkpoints by coding session

## Installation

1. Open Zed
2. Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux) to open Command Palette
3. Type "Vibe" to see available commands
4. Run `/create-checkpoint`, `/quick-save`, `/rollback`, etc.

## Commands

| Command | Description |
|---------|-------------|
| `/create-checkpoint <name>` | Create a checkpoint with a description |
| `/quick-save` | Fast checkpoint without prompt |
| `/rollback <checkpoint-id>` | Rollback to a specific checkpoint |
| `/view-diff <checkpoint-id>` | Show diff from a checkpoint |
| `/list-checkpoints [session-id]` | List all checkpoints (optionally filtered by session) |
| `/delete-checkpoint <id>` | Delete a checkpoint |

## Requirements

- Git repository (recommended for full functionality)
- Zed editor

## License

MIT

---

This is the Zed port of the [VS Code extension](https://github.com/aresnasa/vibe-code-guardian).
