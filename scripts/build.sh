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
SKIP_ZED=false  # whether to skip zed extension publish

# Parse additional arguments (skip first 2 if they exist, otherwise skip 1)
if [ $# -ge 2 ]; then
    shift 2
elif [ $# -eq 1 ]; then
    shift 1
fi

for arg in "$@"; do
    case "$arg" in
        --skip-zed)
            SKIP_ZED=true
            ;;
        *)
            log_warning "Unknown argument: $arg"
            ;;
    esac
done

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

# Ensure zed repo ignores local build artifacts
ensure_zed_ignore_rules() {
    local zed_ignore_file="zed/.gitignore"
    local changed=0

    if [ ! -f "$zed_ignore_file" ]; then
        cat > "$zed_ignore_file" <<'EOF'
target/
Cargo.lock
EOF
        changed=1
    else
        if ! grep -qx 'target/' "$zed_ignore_file"; then
            echo "target/" >> "$zed_ignore_file"
            changed=1
        fi
        if ! grep -qx 'Cargo.lock' "$zed_ignore_file"; then
            echo "Cargo.lock" >> "$zed_ignore_file"
            changed=1
        fi
    fi

    return $changed
}

# Publish zed extension to crates.io
publish_zed_to_crates_io() {
    local release_version="$1"

    if [ ! -d "zed" ]; then
        log_warning "zed directory not found, skipping zed publish"
        return 0
    fi

    log_info "Publishing zed extension to crates.io..."

    pushd zed > /dev/null

    # Check if cargo is installed
    if ! command_exists cargo; then
        log_error "cargo is not installed. Cannot publish zed extension."
        popd > /dev/null
        return 1
    fi

    # Update version in extension.toml to match main project
    sed -i '' "s/version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"${release_version}\"/" extension.toml

    # Update version in Cargo.toml to match main project
    sed -i '' "s/version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"${release_version}\"/" Cargo.toml

    # Commit version updates before building
    git add extension.toml Cargo.toml
    git commit -m "chore: bump version to ${release_version}"

    log_info "Building zed extension..."
    cargo build --release

    if [ $? -ne 0 ]; then
        log_error "Zed extension build failed"
        popd > /dev/null
        return 1
    fi

    # Check if user wants to publish to crates.io
    if command -v cargo &> /dev/null; then
        log_info "Publishing to crates.io..."

        # Check if there are any uncommitted changes before publishing
        if ! git diff --quiet || ! git diff --cached --quiet; then
            log_warning "There are uncommitted changes. Adding and committing..."
            git add -A
            git commit -m "chore: final changes before publishing"
        fi

        cargo publish

        if [ $? -eq 0 ]; then
            log_success "Zed extension published to crates.io!"
            log_info "Package URL: https://crates.io/crates/vibe-code-guardian"
        else
            log_warning "Zed extension publish to crates.io failed or was aborted"
            popd > /dev/null
            return 1
        fi
    else
        log_warning "Skipping zed publish (cargo not available)"
    fi

    # Push the version commit
    log_info "Pushing zed version commit..."
    git push

    popd > /dev/null
    return 0
}

# Commit and push zed submodule repository first, then return to root
sync_zed_submodule() {
    local release_version="$1"

    if [ ! -d "zed" ]; then
        log_warning "zed directory not found, skipping zed sync"
        return 0
    fi

    if [ ! -d "zed/.git" ] && [ ! -f "zed/.git" ]; then
        log_warning "zed is not a git repository, skipping zed sync"
        return 0
    fi

    log_info "Syncing zed repository..."
    ensure_zed_ignore_rules || true

    pushd zed > /dev/null

    local zed_branch
    zed_branch=$(git rev-parse --abbrev-ref HEAD)

    if ! git diff --quiet || ! git diff --cached --quiet; then
        log_info "Staging zed changes..."
        git add -A
        log_info "Committing zed changes..."
        git commit -m "chore: sync zed for release v${release_version}"
    else
        log_success "No zed changes to commit"
    fi

    log_info "Pushing zed (${zed_branch})..."
    git push origin "$zed_branch"

    local zed_head
    zed_head=$(git rev-parse --short HEAD)
    popd > /dev/null

    git add zed .gitmodules 2>/dev/null || true
    log_success "zed synced at ${zed_head}"
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
    local skip_zed="${2:-false}"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "Publishing to VS Code Marketplace..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if ! command_exists vsce; then
        log_info "Installing @vscode/vsce..."
        npm install -g @vscode/vsce
    fi

    local current_version=$(get_version)

    # Publish zed extension first
    if [ "$skip_zed" = "false" ]; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        log_info "Publishing Zed extension..."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        publish_zed_to_crates_io "$current_version"

        if [ $? -ne 0 ]; then
            log_warning "Zed extension publish failed, but continuing with VS Code publish"
        fi
    else
        log_info "Skipping Zed extension publish (--skip-zed flag provided)"
    fi

    log_info "Publishing version $current_version to VS Code Marketplace..."
    npx @vscode/vsce publish

    log_success "Published version $current_version!"
    log_info "Extension URL: https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian"

    # Print zed information
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "Zed Extension Info"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "To install in Zed, add to your settings.json:"
    echo "  \"extensions\": {"
    echo "    \"vibe-code-guardian\": {"
    echo "      \"version\": \"${current_version}\""
    echo "    }"
    echo "  }"
    log_info "Or run: zed extensions install vibe-code-guardian"
    echo ""
}

# Function to push to git
do_git_push() {
    local create_tag="${1:-true}"  # Create git tag by default
    local release_type="${2:-false}"  # Whether this is a release (publish/full)

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "Pushing to GitHub..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if ! command_exists git; then
        log_error "Git is not installed"
        return 1
    fi

    local current_version=$(get_version)

    # Sync zed first so main repo can include the latest submodule pointer
    sync_zed_submodule "$current_version"

    # Check if there are changes to commit
    if git diff --quiet && git diff --cached --quiet; then
        log_warning "No changes to commit"
    else
        log_info "Staging changes..."
        git add .

        log_info "Committing changes..."

        if [ "$release_type" = "true" ]; then
            git commit -m "🚀 Release v${current_version}"
        else
            git commit -m "📦 Build v${current_version}"
        fi
    fi

    # Only create git tags for releases, not for regular builds
    if [ "$create_tag" = "true" ] && [ "$release_type" = "true" ]; then
        log_info "Creating git tag for release..."
        git tag "v${current_version}" 2>/dev/null || log_warning "Tag v${current_version} already exists"

        log_info "Pushing to remote..."
        git push origin main
        git push origin "v${current_version}" 2>/dev/null || log_warning "Tag push skipped"
    elif [ "$create_tag" = "true" ]; then
        # Just push without tag for regular builds
        log_info "Pushing to remote..."
        git push origin main
    else
        # Don't push for non-release operations
        log_info "Git changes committed, but not pushed (not a release)"
    fi

    log_success "GitHub operations completed!"
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
        do_publish "$SKIP_ZED"
        do_git_push true true  # create tag, this is a release
        ;;
    full)
        # Full release with version bump
        log_warning "Bumping $VERSION_BUMP version..."
        new_version=$(bump_version "$VERSION_BUMP")
        log_success "Version updated to $new_version"

        do_build
        do_package
        do_publish "$SKIP_ZED"
        do_git_push true true  # create tag, this is a release
        ;;
    *)
        log_error "Unknown mode: $MODE"
        echo ""
        echo "Usage: $0 [mode] [version-bump] [options]"
        echo ""
        echo "Modes:"
        echo "  build      - Compile and verify the project (default)"
        echo "  package    - Build and create .vsix package"
        echo "  publish    - Build, package, publish to VS Code Marketplace and Zed, and push to GitHub"
        echo "  full       - Full release with version bump"
        echo ""
        echo "Version bump (for 'full' mode):"
        echo "  patch      - Bump patch version (0.1.5 → 0.1.6)"
        echo "  minor      - Bump minor version (0.1.5 → 0.2.0)"
        echo "  major      - Bump major version (0.1.5 → 1.0.0)"
        echo ""
        echo "Options:"
        echo "  --skip-zed Skip publishing Zed extension to crates.io"
        echo ""
        echo "Examples:"
        echo "  ./scripts/build.sh build"
        echo "  ./scripts/build.sh package"
        echo "  ./scripts/build.sh publish"
        echo "  ./scripts/build.sh publish patch --skip-zed"
        echo "  ./scripts/build.sh full minor"
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

