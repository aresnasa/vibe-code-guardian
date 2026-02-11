# Vibe Code Guardian - Project Overview

## Purpose
A game-like checkpoint/save system for AI-assisted coding. Allows users to create manual or automatic checkpoints during AI-assisted code development, and rollback to any checkpoint with diff preview and git integration.

## Tech Stack
- **Language**: TypeScript (strict mode)
- **Target**: Node16, ES2022
- **Key Dependencies**: 
  - VS Code Extension API
  - simple-git (for git operations)
  - esbuild (bundling)
- **Build**: TypeScript compiler, esbuild
- **Testing**: Mocha

## Key Files
- `src/gitManager.ts` - Git operations and repository management
- `src/extension.ts` - Main extension entry point
- `src/checkpointManager.ts` - Checkpoint creation and management
- `src/rollbackManager.ts` - Rollback functionality
- `src/timelineTreeProvider.ts` - UI for timeline view

## Code Conventions
- TypeScript strict mode enabled
- Type hints for all methods and properties
- Public/private method visibility modifiers
- Async/await for async operations
- Console logging for debugging
