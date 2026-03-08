#!/bin/bash

# Simple test script for --hard reset functionality

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Testing --hard Reset Functionality"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ ${NC}$1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Step 1: Show current state
log_info "Current Git Status:"
git status --short
echo ""

# Step 2: Check if there are changes
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    log_warning "Working directory is clean - no changes to backup"
    log_info "Let's create some test changes first..."
    echo ""
    echo "Creating test file..." > test-temp.txt
    log_success "Created test-temp.txt"
    echo ""
    git status --short
    echo ""
fi

# Step 3: Test backup creation
log_info "Step 1: Creating backup..."
backup_timestamp=$(date +"%Y%m%d_%H%M%S")
backup_dir=".backup/${backup_timestamp}"

mkdir -p ".backup"

# Create stash
git stash push -u -m "Test backup before hard reset at ${backup_timestamp}" --include-untracked 2>/dev/null

if [ $? -eq 0 ]; then
    stash_ref=$(git stash list -n 1 --format="%H")
    log_success "Backup created!"
    log_info "  Stash ref: ${stash_ref:0:8}..."
    log_info "  Timestamp: $backup_timestamp"

    # Log backup
    echo "Backup: $backup_timestamp | $stash_ref" >> ".backup/backups.txt"
else
    log_warning "No changes to backup"
fi

echo ""

# Step 4: Show stashes
log_info "Step 2: Available backups (Git Stashes):"
git stash list
echo ""

# Step 5: Restore backup
read -p "Do you want to restore the backup now? (y/n): " -n 1 -r
echo
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Restoring backup..."
    git stash pop

    if [ $? -eq 0 ]; then
        log_success "Backup restored successfully!"
        echo ""
        log_info "Files after restore:"
        git status --short
        echo ""

        if [ -f "test-temp.txt" ]; then
            log_success "✓ test-temp.txt is present"
            cat test-temp.txt
        fi
    else
        log_error "Failed to restore backup"
    fi
else
    log_info "Skipping restore - backup is saved in git stash"
    echo ""
    log_info "You can restore later using:"
    echo "  git stash pop        # Restore latest"
    echo "  git stash list       # View all backups"
    echo "  git stash drop       # Remove latest stash"
fi

echo ""
log_success "Test completed!"
echo ""
echo "─────────────────────────────────────────────────────"
echo "Next steps:"
echo "─────────────────────────────────────────────────────"
echo ""
echo "1. Test with build.sh --hard:"
echo "   ./scripts/build.sh build --hard"
echo ""
echo "2. Check backups:"
echo "   cat .backup/backups.txt"
echo "   git stash list"
echo ""
echo "3. Clean up test files:"
echo "   rm -f test-temp.txt test-untracked-*.txt"
echo "   rm -rf .backup/"
echo ""