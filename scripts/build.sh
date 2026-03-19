#!/bin/bash

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Vibe Code Guardian - Unified Build & Publish Script
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
# This script handles the complete lifecycle:
#   build     → compile TypeScript + verify
#   package   → build + create .vsix
#   publish   → build + package + publish VS Code + publish Zed + git tag
#   full      → version bump + publish
#
# Zed publishing is fully automated via GitHub CLI (gh):
#   1. Push zed submodule to aresnasa/vibe-code-guardian-zed
#   2. Clone/update fork of zed-industries/extensions
#   3. Update submodule pointer + extensions.toml version
#   4. Create PR to zed-industries/extensions
#
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Color codes ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Constants ─────────────────────────────────────────────────────────────────
ZED_SUBMODULE_DIR="zed"
ZED_SUBMODULE_REMOTE="https://github.com/aresnasa/vibe-code-guardian-zed.git"
ZED_EXTENSIONS_UPSTREAM="zed-industries/extensions"
ZED_EXTENSIONS_FORK="aresnasa/extensions"
ZED_EXTENSION_ID="vibe-code-guardian"
VSCODE_PUBLISHER="vibe-coder"
WASM_TARGET="wasm32-wasip1"

# ── Parse CLI arguments ──────────────────────────────────────────────────────
MODE="${1:-build}"
VERSION_BUMP="${2:-patch}"
SKIP_ZED=false
SKIP_VSCODE=false
HARD_RESET=false
DRY_RUN=false

if [ $# -ge 2 ]; then
    shift 2
elif [ $# -eq 1 ]; then
    shift 1
fi

for arg in "$@"; do
    case "$arg" in
        --skip-zed)    SKIP_ZED=true ;;
        --skip-vscode) SKIP_VSCODE=true ;;
        --hard)        HARD_RESET=true ;;
        --dry-run)     DRY_RUN=true ;;
        *)             log_warning "Unknown argument: $arg" ;;
    esac
done

# ── Logging helpers ───────────────────────────────────────────────────────────
log_info()    { echo -e "${BLUE}ℹ ${NC}$1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_step()    { echo -e "\n${CYAN}${BOLD}▸ $1${NC}"; }
log_banner()  {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e " ${BOLD}$1${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# ── Utility ───────────────────────────────────────────────────────────────────
command_exists() { command -v "$1" &>/dev/null; }

get_version() {
    grep '"version"' package.json | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/'
}

bump_version() {
    local current_version
    current_version=$(get_version)
    local new_version=""

    case "$1" in
        patch) new_version=$(echo "$current_version" | awk -F. '{$NF++;print}' OFS=.) ;;
        minor) new_version=$(echo "$current_version" | awk -F. '{$(NF-1)++;$NF=0;print}' OFS=.) ;;
        major) new_version=$(echo "$current_version" | awk -F. '{$1++;$2=0;$NF=0;print}' OFS=.) ;;
        *)     log_error "Unknown version bump type: $1"; return 1 ;;
    esac

    sed -i '' "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" package.json
    echo "$new_version"
}

# ── Preflight checks ─────────────────────────────────────────────────────────
preflight_check() {
    local target="$1"  # build | package | publish
    local missing=()

    command_exists node || missing+=("node")
    command_exists npm  || missing+=("npm")
    command_exists git  || missing+=("git")

    if [[ "$target" == "package" || "$target" == "publish" ]]; then
        command_exists npx || missing+=("npx")
    fi

    if [[ "$target" == "publish" ]]; then
        if [ "$SKIP_ZED" = "false" ]; then
            command_exists gh    || missing+=("gh (GitHub CLI)")
            command_exists cargo || missing+=("cargo (Rust toolchain)")
        fi
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing required tools: ${missing[*]}"
        echo "  Install them before continuing."
        return 1
    fi

    log_success "All required tools available"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# BACKUP & HARD RESET
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

create_backup() {
    local ts
    ts=$(date +"%Y%m%d_%H%M%S")
    local backup_dir=".backup/${ts}"
    mkdir -p "$backup_dir"

    log_info "Creating backup → .backup/${ts}"
    git stash push -u -m "Auto-backup before hard reset at ${ts}" --include-untracked 2>/dev/null || true

    git rev-parse HEAD > "$backup_dir/git_head.txt"
    git rev-parse --abbrev-ref HEAD > "$backup_dir/git_branch.txt"
    git log --oneline -1 > "$backup_dir/git_commit.txt"
    cp package.json "$backup_dir/" 2>/dev/null || true

    echo "$(date) | ${ts} | $(git rev-parse --short HEAD)" >> ".backup/backup.log"
    log_success "Backup saved to .backup/${ts}"
}

check_hard_reset() {
    [ "$HARD_RESET" != "true" ] && return 0

    log_banner "⚠  Hard Reset Mode"
    log_info "This will reset the working directory to a clean state."

    if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
        create_backup
    fi

    read -p "Proceed with hard reset? (y/n): " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && { log_info "Cancelled."; exit 0; }

    git reset --hard HEAD
    git clean -fd
    log_success "Hard reset completed"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# BUILD
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

do_build() {
    log_banner "🔨 Building Vibe Code Guardian"

    log_step "Checking environment"
    log_success "Node $(node --version)  •  npm $(npm --version)"

    if [ ! -d "node_modules" ] || [ ! -d "node_modules/@types/node" ] || [ ! -d "node_modules/@types/vscode" ]; then
        log_step "Installing dependencies"
        npm install
    fi

    # Clean up pnpm residuals that may leak from Zed publish operations
    if [ -d "node_modules/.pnpm" ]; then
        log_warning "Removing pnpm residuals from node_modules"
        rm -rf node_modules/.pnpm
    fi

    log_step "Type checking"
    npm run check-types

    log_step "Linting"
    npm run lint

    log_step "Bundling with esbuild"
    node esbuild.js

    if [ -f "dist/extension.js" ]; then
        local size
        size=$(du -h dist/extension.js | cut -f1)
        log_success "dist/extension.js (${size})"
    else
        log_error "Build output not found: dist/extension.js"
        return 1
    fi

    log_success "Build completed"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PACKAGE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

do_package() {
    log_banner "📦 Packaging VS Code Extension"

    local version
    version=$(get_version)
    local vsix="vibe-code-guardian-${version}.vsix"

    log_step "Creating ${vsix}"
    npx @vscode/vsce package

    if [ -f "$vsix" ]; then
        local size
        size=$(du -h "$vsix" | cut -f1)
        log_success "Package created: ${vsix} (${size})"
    else
        log_error "Package creation failed"
        return 1
    fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# VS CODE MARKETPLACE PUBLISH
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

check_vsce_auth() {
    if [ -n "$VSCE_PAT" ]; then
        log_info "Using VSCE_PAT environment variable"
        return 0
    fi
    if npx @vscode/vsce verify-pat "$VSCODE_PUBLISHER" &>/dev/null; then
        log_success "Already authenticated with VS Code Marketplace"
        return 0
    fi
    return 1
}

handle_vsce_auth() {
    log_info "Authentication required for VS Code Marketplace"
    echo ""
    echo "  1. Visit: https://marketplace.visualstudio.com/manage/publishers/${VSCODE_PUBLISHER}"
    echo "  2. Create a PAT with 'Marketplace → Manage' scope"
    echo "  3. Set: export VSCE_PAT='your_token'"
    echo ""

    if [ -z "$VSCE_PAT" ]; then
        read -p "Enter your PAT (or Ctrl+C to cancel): " -r vsce_token
        [ -z "$vsce_token" ] && { log_error "No PAT provided"; return 1; }
        export VSCE_PAT="$vsce_token"
    fi

    echo "$VSCE_PAT" | npx @vscode/vsce login "$VSCODE_PUBLISHER" --pat
    log_success "Authentication successful"
}

publish_vscode() {
    local version="$1"

    log_banner "🟣 Publishing to VS Code Marketplace"

    if ! check_vsce_auth; then
        if ! handle_vsce_auth; then
            log_error "Cannot publish without authentication"
            return 1
        fi
    fi

    log_step "Publishing v${version}"

    if [ "$DRY_RUN" = "true" ]; then
        log_warning "[DRY RUN] Would run: npx @vscode/vsce publish"
        return 0
    fi

    if npx @vscode/vsce publish; then
        log_success "Published v${version} to VS Code Marketplace"
        log_info "URL: https://marketplace.visualstudio.com/items?itemName=${VSCODE_PUBLISHER}.${ZED_EXTENSION_ID}"
    else
        local rc=$?
        # "already exists" is not a real failure when re-publishing the same version
        if npx @vscode/vsce show "${VSCODE_PUBLISHER}.${ZED_EXTENSION_ID}" --json 2>/dev/null | grep -q "\"version\":\"${version}\""; then
            log_warning "v${version} already exists on Marketplace — skipping"
        else
            log_error "vsce publish exited with code ${rc}"
            return 1
        fi
    fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ZED EXTENSION PUBLISH (full automation via gh CLI)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Step 1: Update version in zed submodule and push to its remote
zed_update_submodule() {
    local version="$1"

    log_step "Updating zed submodule → v${version}"

    if [ ! -d "$ZED_SUBMODULE_DIR" ]; then
        log_warning "zed/ directory not found – skipping"
        return 1
    fi

    pushd "$ZED_SUBMODULE_DIR" > /dev/null

    # Update version in extension.toml (all occurrences) & Cargo.toml (first occurrence only)
    sed -i '' "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"${version}\"/" extension.toml
    # macOS sed doesn't support 0,/pattern/; use /^name/,/^version/ range to target [package] block
    sed -i '' "/^name = /,/^version = /s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"${version}\"/" Cargo.toml

    if ! git diff --quiet || ! git diff --cached --quiet; then
        git add extension.toml Cargo.toml
        git commit -m "chore: bump version to ${version}"
        log_success "Zed submodule version bumped to ${version}"
    else
        log_success "Zed submodule already at v${version}"
    fi

    popd > /dev/null
}

# Step 2: Build the Zed extension as wasm32-wasip1 to verify compilation
zed_build_wasm() {
    log_step "Building Zed extension (wasm32-wasip1)"

    pushd "$ZED_SUBMODULE_DIR" > /dev/null

    # Ensure the wasm target is installed
    if ! rustup target list --installed | grep -q "$WASM_TARGET"; then
        log_info "Installing ${WASM_TARGET} target..."
        rustup target add "$WASM_TARGET"
    fi

    cargo build --target "$WASM_TARGET" --release 2>&1
    log_success "Zed extension compiled to wasm successfully"

    popd > /dev/null
}

# Step 3: Push zed submodule to its own GitHub repo
zed_push_submodule() {
    log_step "Pushing zed submodule to GitHub"

    pushd "$ZED_SUBMODULE_DIR" > /dev/null || {
        log_error "Failed to enter zed submodule directory"
        return 1
    }

    local branch
    branch=$(git rev-parse --abbrev-ref HEAD)

    if [ "$DRY_RUN" = "true" ]; then
        log_warning "[DRY RUN] Would push to origin/${branch}"
    else
        if ! git push origin "$branch" 2>&1; then
            log_error "Failed to push zed submodule to origin/${branch}"
            popd > /dev/null
            return 1
        fi
    fi

    local commit
    commit=$(git rev-parse --short HEAD)
    log_success "Pushed zed submodule (${commit}) to origin/${branch}"

    popd > /dev/null

    # Update parent repo's submodule pointer
    git add "$ZED_SUBMODULE_DIR"
}

# Step 4: Clone fork, update submodule pointer + extensions.toml, create PR
zed_create_pr() {
    local version="$1"
    local work_dir
    work_dir=$(mktemp -d)
    local pr_branch="update-${ZED_EXTENSION_ID}-v${version}"

    log_step "Preparing PR to ${ZED_EXTENSIONS_UPSTREAM}"

    # ── Ensure the fork exists ────────────────────────────────────────────
    if ! gh repo view "$ZED_EXTENSIONS_FORK" --json name &>/dev/null; then
        log_info "Fork not found. Forking ${ZED_EXTENSIONS_UPSTREAM}..."
        gh repo fork "$ZED_EXTENSIONS_UPSTREAM" --clone=false
    fi

    # ── Clone the fork ────────────────────────────────────────────────────
    log_info "Cloning fork → ${work_dir}/extensions"
    if ! gh repo clone "$ZED_EXTENSIONS_FORK" "${work_dir}/extensions" -- --depth=1 2>&1; then
        log_error "Failed to clone fork ${ZED_EXTENSIONS_FORK}"
        rm -rf "$work_dir"
        return 1
    fi

    if [ ! -d "${work_dir}/extensions/.git" ]; then
        log_error "Clone directory does not contain a valid git repo"
        rm -rf "$work_dir"
        return 1
    fi

    pushd "${work_dir}/extensions" > /dev/null || {
        log_error "Failed to enter clone directory"
        rm -rf "$work_dir"
        return 1
    }

    # Set upstream
    git remote add upstream "https://github.com/${ZED_EXTENSIONS_UPSTREAM}.git" 2>/dev/null || true
    git fetch upstream main --depth=1
    git reset --hard upstream/main

    # ── Create branch ─────────────────────────────────────────────────────
    git checkout -b "$pr_branch"

    # ── Check if submodule already exists ─────────────────────────────────
    if [ -d "extensions/${ZED_EXTENSION_ID}" ]; then
        log_info "Submodule already exists – updating pointer"
        git submodule update --init "extensions/${ZED_EXTENSION_ID}" 2>/dev/null || true

        pushd "extensions/${ZED_EXTENSION_ID}" > /dev/null
        git fetch origin
        git checkout origin/main
        popd > /dev/null

        git add "extensions/${ZED_EXTENSION_ID}"
    else
        log_info "Adding submodule for the first time"
        git submodule add "$ZED_SUBMODULE_REMOTE" "extensions/${ZED_EXTENSION_ID}"
        git add "extensions/${ZED_EXTENSION_ID}"
    fi

    # ── Update extensions.toml ────────────────────────────────────────────
    if grep -q "^\[${ZED_EXTENSION_ID}\]" extensions.toml; then
        # Update existing entry version
        log_info "Updating version in extensions.toml"
        # Use perl for reliable multi-line TOML section editing
        perl -i -0pe "s/(\[${ZED_EXTENSION_ID}\]\s*\n(?:(?!\[)[^\n]*\n)*?version\s*=\s*)\"[^\"]*\"/\1\"${version}\"/" extensions.toml
    else
        # Insert new entry in alphabetical order using perl (portable across macOS/Linux)
        log_info "Adding new entry to extensions.toml"
        perl -i -e '
            use strict;
            my $id = "'"${ZED_EXTENSION_ID}"'";
            my $ver = "'"${version}"'";
            my $entry = "\n[$id]\nsubmodule = \"extensions/$id\"\nversion = \"$ver\"\n";
            my $inserted = 0;
            while (<>) {
                # Insert before the first [section] that sorts after our ID
                if (!$inserted && /^\[([^\]]+)\]/ && $1 gt $id) {
                    print $entry;
                    $inserted = 1;
                }
                print;
            }
            # If nothing sorted after us, append at the end
            print $entry unless $inserted;
        ' extensions.toml
    fi

    git add extensions.toml

    # ── Sort extensions (skip pnpm to avoid polluting main project) ─────
    # Note: pnpm install in the zed-industries/extensions clone can leak
    # packages into the main project's node_modules via pnpm hoisting.
    # The sort is cosmetic only — the PR works fine without it.
    git add .gitmodules 2>/dev/null || true

    # ── Commit & push ─────────────────────────────────────────────────────
    if git diff --cached --quiet; then
        log_warning "No changes to commit – PR may already be up to date"
        popd > /dev/null
        rm -rf "$work_dir"
        return 0
    fi

    git commit -m "Update ${ZED_EXTENSION_ID} to v${version}"

    if [ "$DRY_RUN" = "true" ]; then
        log_warning "[DRY RUN] Would push branch and create PR"
        popd > /dev/null
        rm -rf "$work_dir"
        return 0
    fi

    if ! git push origin "$pr_branch" --force 2>&1; then
        log_error "Failed to push branch ${pr_branch}"
        popd > /dev/null
        rm -rf "$work_dir"
        return 1
    fi

    # ── Create PR via gh CLI ──────────────────────────────────────────────
    local pr_url
    pr_url=$(gh pr create \
        --repo "$ZED_EXTENSIONS_UPSTREAM" \
        --base main \
        --head "aresnasa:${pr_branch}" \
        --title "Update ${ZED_EXTENSION_ID} to v${version}" \
        --body "## Update Vibe Code Guardian Extension

**Extension ID:** \`${ZED_EXTENSION_ID}\`
**Version:** \`${version}\`
**Repository:** ${ZED_SUBMODULE_REMOTE%.git}
**License:** MIT

### Description

A game-like checkpoint/save system for AI-assisted coding (vibe coding).

### Changes

- Updated extension to v${version}
- Submodule pointer updated to latest commit

### Checklist

- [x] Extension repository uses HTTPS URL
- [x] \`extension.toml\` has required fields
- [x] MIT license included
- [x] Extension compiles to wasm32-wasip1
- [x] \`extensions.toml\` version matches \`extension.toml\`
- [x] Extension ID does not contain \"zed\"" 2>&1)

    if [ -z "$pr_url" ] || echo "$pr_url" | grep -qi "error\|failed"; then
        log_error "PR creation failed: ${pr_url}"
        popd > /dev/null
        rm -rf "$work_dir"
        return 1
    fi

    log_success "PR created: ${pr_url}"

    popd > /dev/null
    rm -rf "$work_dir"

    echo ""
    log_info "PR URL: ${pr_url}"
    log_info "Once merged, users can install via Zed Extensions panel."
}

# Orchestrate all Zed publish steps
publish_zed() {
    local version="$1"

    log_banner "🔵 Publishing Zed Extension to zed.dev"

    zed_update_submodule "$version" || {
        log_error "Failed to update Zed submodule"
        return 1
    }
    zed_build_wasm || {
        log_error "Zed WASM build failed"
        return 1
    }
    zed_push_submodule || {
        log_error "Failed to push Zed submodule"
        return 1
    }
    zed_create_pr "$version" || {
        log_error "Failed to create Zed PR"
        return 1
    }

    log_success "Zed extension publish flow completed"
    log_info "Extension page: https://zed.dev/extensions?query=${ZED_EXTENSION_ID}"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# GIT SYNC & TAG
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

sync_zed_submodule() {
    local version="$1"

    [ ! -d "$ZED_SUBMODULE_DIR" ] && return 0
    [ ! -d "$ZED_SUBMODULE_DIR/.git" ] && [ ! -f "$ZED_SUBMODULE_DIR/.git" ] && return 0

    log_step "Syncing zed submodule"

    pushd "$ZED_SUBMODULE_DIR" > /dev/null

    local branch
    branch=$(git rev-parse --abbrev-ref HEAD)

    if ! git diff --quiet || ! git diff --cached --quiet; then
        git add -A
        git commit -m "chore: sync zed for release v${version}"
    fi

    git push origin "$branch" 2>/dev/null || true

    local head
    head=$(git rev-parse --short HEAD)

    popd > /dev/null

    git add "$ZED_SUBMODULE_DIR" .gitmodules 2>/dev/null || true
    log_success "Zed submodule synced at ${head}"
}

do_git_push() {
    local is_release="$1"  # true | false
    local version
    version=$(get_version)

    log_banner "🔀 Git Push"

    sync_zed_submodule "$version"

    if ! git diff --quiet || ! git diff --cached --quiet; then
        git add .
        if [ "$is_release" = "true" ]; then
            git commit -m "🚀 Release v${version}"
        else
            git commit -m "📦 Build v${version}"
        fi
    else
        log_info "No changes to commit"
    fi

    if [ "$is_release" = "true" ]; then
        git tag "v${version}" 2>/dev/null || log_warning "Tag v${version} already exists"

        if [ "$DRY_RUN" = "true" ]; then
            log_warning "[DRY RUN] Would push to origin/main + tag v${version}"
        else
            git push origin main
            git push origin "v${version}" 2>/dev/null || log_warning "Tag push skipped (already exists)"
        fi
    else
        if [ "$DRY_RUN" = "true" ]; then
            log_warning "[DRY RUN] Would push to origin/main"
        else
            git push origin main
        fi
    fi

    log_success "Git operations completed"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

do_test() {
    log_banner "🧪 Running Test Suite"

    local passed=0
    local failed=0

    # ── 1. Unit tests (VS Code extension API + CheckpointManager) ────────
    log_step "Unit tests (npm test)"
    if npm test; then
        log_success "Unit tests passed"
        ((passed++))
    else
        log_error "Unit tests FAILED"
        ((failed++))
    fi

    # ── 2. Integration tests (run-tests.sh shell suite) ──────────────────
    log_step "Integration tests (scripts/run-tests.sh)"
    if bash "${PROJECT_ROOT}/scripts/run-tests.sh"; then
        log_success "Integration tests passed"
        ((passed++))
    else
        log_error "Integration tests FAILED"
        ((failed++))
    fi

    # ── Summary ───────────────────────────────────────────────────────────
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [ $failed -eq 0 ]; then
        log_success "All test suites passed ($passed/$((passed + failed)))"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        return 0
    else
        log_error "$failed test suite(s) FAILED (passed: $passed / total: $((passed + failed)))"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        return 1
    fi
}

# Run tests then install the .vsix into this workspace's VS Code for manual verification
do_local_test() {
    log_banner "🔬 Local Extension Test"
    local version
    version=$(get_version)
    local vsix="vibe-code-guardian-${version}.vsix"

    # 1. Run automated tests first
    do_test || {
        log_error "Automated tests failed – aborting local install"
        return 1
    }

    # 2. Build + package
    do_build
    do_package

    # 3. Install .vsix into VS Code
    if [ ! -f "$vsix" ]; then
        log_error ".vsix not found: $vsix"
        return 1
    fi

    log_step "Installing ${vsix} into VS Code for manual verification"
    if command_exists code; then
        if [ "$DRY_RUN" = "true" ]; then
            log_warning "[DRY RUN] Would run: code --install-extension ${vsix}"
        else
            code --install-extension "$vsix"
            log_success "Extension installed. Reload VS Code and verify milestone features."
            log_info "Reload with: Cmd+Shift+P → Developer: Reload Window"
        fi
    else
        log_warning "'code' CLI not found – install manually:"
        log_info "  code --install-extension ${vsix}"
    fi
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FULL PUBLISH ORCHESTRATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

do_publish() {
    local version
    version=$(get_version)

    log_banner "🚀 Publishing Vibe Code Guardian v${version}"

    # ── Gate: tests must pass before publish ─────────────────────────────
    log_step "Pre-publish gate: running all tests"
    do_test || {
        log_error "Tests failed – publish aborted. Fix issues before releasing."
        return 1
    }

    # ── Zed publish ───────────────────────────────────────────────────────
    if [ "$SKIP_ZED" = "false" ]; then
        publish_zed "$version" || {
            log_warning "Zed publish encountered issues – continuing with VS Code"
        }
    else
        log_info "Skipping Zed publish (--skip-zed)"
    fi

    # ── VS Code publish ───────────────────────────────────────────────────
    if [ "$SKIP_VSCODE" = "false" ]; then
        publish_vscode "$version" || {
            log_error "VS Code Marketplace publish failed"
            return 1
        }
    else
        log_info "Skipping VS Code publish (--skip-vscode)"
    fi

    # ── Summary ───────────────────────────────────────────────────────────
    log_banner "✅ Publish Summary"
    echo ""
    log_info "Version: ${version}"
    [ "$SKIP_VSCODE" = "false" ] && \
        log_info "VS Code: https://marketplace.visualstudio.com/items?itemName=${VSCODE_PUBLISHER}.${ZED_EXTENSION_ID}"
    [ "$SKIP_ZED" = "false" ] && \
        log_info "Zed:     https://zed.dev/extensions?query=${ZED_EXTENSION_ID}"
    echo ""
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# USAGE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

show_usage() {
    cat <<'EOF'

  Vibe Code Guardian – Build & Publish

  Usage:
    ./scripts/build.sh <mode> [version-bump] [options]

  Modes:
    build       Compile TypeScript, type-check, lint, bundle
    test        Run unit tests + integration tests
    local-test  test + build + install .vsix into VS Code for manual verification
    package     build + create .vsix package
    publish     test + build + package + publish VS Code + Zed + git tag
    full        Version bump + test + publish (complete release)

  Version bump (for 'full' mode):
    patch       0.6.0 → 0.6.1
    minor       0.6.0 → 0.7.0
    major       0.6.0 → 1.0.0

  Options:
    --skip-zed      Skip Zed extension publishing
    --skip-vscode   Skip VS Code Marketplace publishing
    --hard          Hard reset with auto-backup before build
    --dry-run       Simulate publish without pushing/uploading

  Environment:
    VSCE_PAT        VS Code Marketplace Personal Access Token

  Examples:
    ./scripts/build.sh build
    ./scripts/build.sh test
    ./scripts/build.sh local-test
    ./scripts/build.sh local-test --dry-run
    ./scripts/build.sh package
    ./scripts/build.sh publish
    ./scripts/build.sh publish --skip-zed
    ./scripts/build.sh publish --dry-run
    ./scripts/build.sh full patch
    ./scripts/build.sh full minor --skip-zed
    ./scripts/build.sh build --hard

  Zed Publishing (automated):
    The script uses GitHub CLI (gh) to:
      1. Push zed submodule to aresnasa/vibe-code-guardian-zed
      2. Update the zed-industries/extensions fork
      3. Create a PR automatically
    Requires: gh auth login

EOF
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MAIN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

case "$MODE" in
    build)
        preflight_check build
        check_hard_reset
        do_build
        ;;

    test)
        preflight_check build
        do_test
        ;;

    local-test)
        preflight_check package
        do_local_test
        ;;

    package)
        preflight_check package
        check_hard_reset
        do_build
        do_package
        ;;

    publish)
        preflight_check publish
        check_hard_reset
        do_build
        do_package
        do_publish
        do_git_push true   # is_release=true
        ;;

    full)
        preflight_check publish
        log_step "Bumping ${VERSION_BUMP} version"
        new_version=$(bump_version "$VERSION_BUMP")
        log_success "Version → ${new_version}"

        check_hard_reset
        do_build
        do_package
        do_publish
        do_git_push true   # is_release=true
        ;;

    help|--help|-h)
        show_usage
        exit 0
        ;;

    *)
        log_error "Unknown mode: ${MODE}"
        show_usage
        exit 1
        ;;
esac

echo ""
log_success "All done! 🎉"
