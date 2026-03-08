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

    if [ ! -d "node_modules" ]; then
        log_step "Installing dependencies"
        npm install
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

    npx @vscode/vsce publish

    log_success "Published v${version} to VS Code Marketplace"
    log_info "URL: https://marketplace.visualstudio.com/items?itemName=${VSCODE_PUBLISHER}.${ZED_EXTENSION_ID}"
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

    # Update version in extension.toml & Cargo.toml
    sed -i '' "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"${version}\"/" extension.toml
    sed -i '' "0,/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/{s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"${version}\"/;}" Cargo.toml

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

    pushd "$ZED_SUBMODULE_DIR" > /dev/null

    local branch
    branch=$(git rev-parse --abbrev-ref HEAD)

    if [ "$DRY_RUN" = "true" ]; then
        log_warning "[DRY RUN] Would push to origin/${branch}"
    else
        git push origin "$branch"
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
    gh repo clone "$ZED_EXTENSIONS_FORK" "${work_dir}/extensions" -- --depth=1 2>&1

    pushd "${work_dir}/extensions" > /dev/null

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
        # Insert new entry in alphabetical order (before [vibescript])
        log_info "Adding new entry to extensions.toml"
        local entry
        entry=$(printf '[%s]\nsubmodule = "extensions/%s"\nversion = "%s"\n' \
            "$ZED_EXTENSION_ID" "$ZED_EXTENSION_ID" "$version")

        # Find the right insertion point: the first [section] that sorts after our ID
        local insert_before=""
        while IFS= read -r section; do
            if [[ "$section" > "[$ZED_EXTENSION_ID]" ]]; then
                insert_before="$section"
                break
            fi
        done < <(grep '^\[' extensions.toml | sort)

        if [ -n "$insert_before" ]; then
            # Escape brackets for sed
            local escaped
            escaped=$(echo "$insert_before" | sed 's/\[/\\[/g; s/\]/\\]/g')
            sed -i '' "/${escaped}/i\\
\\
${entry//\\/\\\\}
" extensions.toml
        else
            # Append at end
            printf '\n%s\n' "$entry" >> extensions.toml
        fi
    fi

    git add extensions.toml

    # ── Sort extensions (if pnpm available) ───────────────────────────────
    if command_exists pnpm; then
        log_info "Running pnpm sort-extensions"
        pnpm install --frozen-lockfile 2>/dev/null || pnpm install 2>/dev/null || true
        pnpm sort-extensions 2>/dev/null || true
        git add extensions.toml .gitmodules 2>/dev/null || true
    fi

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

    git push origin "$pr_branch" --force

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

    zed_update_submodule "$version"
    zed_build_wasm
    zed_push_submodule
    zed_create_pr "$version"

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
# FULL PUBLISH ORCHESTRATION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

do_publish() {
    local version
    version=$(get_version)

    log_banner "🚀 Publishing Vibe Code Guardian v${version}"

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
    package     build + create .vsix package
    publish     build + package + publish VS Code + Zed + git tag
    full        Version bump + publish (complete release)

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
