# Change Log

All notable changes to the "vibe-code-guardian" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.1.6]

### Added
- Automatic build script (`scripts/build.sh`) for compiling the project
- Build script includes type checking, linting, and bundling steps

### Changed
- Bumped version to 0.1.6
- Automatically create comprehensive .gitignore when initializing Git repository
- Enhanced .gitignore with common patterns for all project types including:
  - Cache directories and temporary files
  - Playwright session data (.pw-cache/, playwright-session/)
  - Log files (*.log, logs/ directories)
  - Test output and coverage files
  - IDE/editor specific files
  - OS specific files
  - Environment files
  - Project-specific patterns for Node.js, Python, Go, Rust, Java, .NET, Ruby, PHP

### Fixed
- Removed user choice to create .gitignore (now always created automatically)

## [0.1.2]
- Fix marketplace publishing issues
- General improvements

- Initial release