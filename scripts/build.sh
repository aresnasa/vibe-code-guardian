#!/bin/bash

# Vibe Code Guardian - Build and Publish Script
# This script compiles, packages, and publishes the project to VS Code Marketplace

set -e  # Exit on error

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse command line arguments
MODE="${1:-build}"  # 'build' (default), 'package', or 'publish'
VERSION_BUMP="${2:-patch}"  # 'patch', 'minor', 'major' for version bumping

# Function to print colored output
log_info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Function to get current version from package.json
get_version() {
    grep '"version"' package.json | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/'
}

# Function to bump version in package.json
bump_version() {
    local current_version=$(get_version)
    local new_version=""
    
    case "$1" in
        patch)
            new_version=$(echo "$current_version" | awk -F. '{$NF++;print}' OFS=.)
            ;;
        minor)
            new_version=$(echo "$current_version" | awk -F. '{$(NF-1)++;$NF=0;print}' OFS=.)
            ;;
        major)
            new_version=$(echo "$current_version" | awk -F. '{$1++;$2=0;$NF=0;print}' OFS=.)
            ;;
        *)
            log_error "Unknown version bump type: $1"
            return 1
            ;;
    esac
    
    sed -i '' "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" package.json
    echo "$new_version"
}

# Function to perform the build
do_build() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "Building Vibe Code Guardian..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Check Node.js installation
    log_info "Checking Node.js..."
    if ! command_exists node; then
        log_error "Node.js is not installed"
        return 1
    fi
    log_success "Node.js version: $(node --version)"

    # Check npm installation
    log_info "Checking npm..."
    if ! command_exists npm; then
        log_error "npm is not installed"
        return 1
    fi
    log_success "npm version: $(npm --version)"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        log_info "Installing dependencies..."
        npm install
    else
        log_success "Dependencies already installed"
    fi

    # Type checking
    log_info "Type checking..."
    npm run check-types

    # Linting
    log_info "Running linter..."
    npm run lint

    # Build with esbuild
    log_info "Bundling with esbuild..."
    node esbuild.js

    # Verify output
    log_info "Verifying build..."
    if [ -f "dist/extension.js" ]; then
        local size=$(du -h dist/extension.js | cut -f1)
        log_success "dist/extension.js - OK ($size)"
    else
        log_error "Build output not found: dist/extension.js"
        return 1
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_success "Build completed successfully!"
}

# Function to perform packaging
do_package() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "Packaging extension..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if ! command_exists vsce; then
        log_info "Installing @vscode/vsce..."
        npm install -g @vscode/vsce
    fi

    local current_version=$(get_version)
    local vsix_file="vibe-code-guardian-${current_version}.vsix"

    log_info "Creating package: $vsix_file"
    npx @vscode/vsce package

    if [ -f "$vsix_file" ]; then
        local size=$(du -h "$vsix_file" | cut -f1)
        log_success "Package created: $vsix_file ($size)"
    else
        log_error "Package creation failed"
        return 1
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Function to perform publishing
do_publish() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "Publishing to VS Code Marketplace..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if ! command_exists vsce; then
        log_info "Installing @vscode/vsce..."
        npm install -g @vscode/vsce
    fi

    local current_version=$(get_version)
    
    log_info "Publishing version $current_version..."
    npx @vscode/vsce publish
    
    log_success "Published version $current_version!"
    log_info "Extension URL: https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian"
}

# Function to push to git
do_git_push() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "Pushing to GitHub..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if ! command_exists git; then
        log_error "Git is not installed"
        return 1
    fi

    local current_version=$(get_version)
    
    # Check if there are changes to commit
    if git diff --quiet && git diff --cached --quiet; then
        log_warning "No changes to commit"
    else
        log_info "Staging changes..."
        git add .
        
        log_info "Committing changes..."
        git commit -m "🚀 Release v${current_version}"
    fi

    log_info "Creating git tag..."
    git tag "v${current_version}" 2>/dev/null || log_warning "Tag v${current_version} already exists"

    log_info "Pushing to remote..."
    git push origin main
    git push origin "v${current_version}" 2>/dev/null || log_warning "Tag push skipped"
    
    log_success "GitHub push completed!"
}

# Main execution
case "$MODE" in
    build)
        do_build
        ;;
    package)
        do_build
        do_package
        ;;
    publish)
        do_build
        do_package
        do_publish
        do_git_push
        ;;
    full)
        # Full release with version bump
        log_warning "Bumping $VERSION_BUMP version..."
        local new_version=$(bump_version "$VERSION_BUMP")
        log_success "Version updated to $new_version"
        
        do_build
        do_package
        do_publish
        do_git_push
        ;;
    *)
        log_error "Unknown mode: $MODE"
        echo ""
        echo "Usage: $0 [mode] [version-bump]"
        echo ""
        echo "Modes:"
        echo "  build      - Compile and verify the project (default)"
        echo "  package    - Build and create .vsix package"
        echo "  publish    - Build, package, publish to Marketplace, and push to GitHub"
        echo "  full       - Full release with version bump"
        echo ""
        echo "Version bump (for 'full' mode):"
        echo "  patch      - Bump patch version (0.1.5 → 0.1.6)"
        echo "  minor      - Bump minor version (0.1.5 → 0.2.0)"
        echo "  major      - Bump major version (0.1.5 → 1.0.0)"
        echo ""
        echo "Examples:"
        echo "  ./scripts/build.sh build"
        echo "  ./scripts/build.sh package"
        echo "  ./scripts/build.sh publish"
        echo "  ./scripts/build.sh full patch"
        exit 1
        ;;
esac

if [ $? -eq 0 ]; then
    echo ""
    log_success "All done! 🎉"
else
    log_error "Build/publish failed!"
    exit 1
fi

