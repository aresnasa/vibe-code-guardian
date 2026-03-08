#!/bin/bash

# Git Rollback and Tracking Test Demo
# This script demonstrates the --hard rollback functionality with backup

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 Git Rollback & Tracking Test Demo"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ ${NC}$1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Step 1: Show current git status
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 1: Current Git Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
git status
echo ""

# Step 2: Create some test files to simulate uncommitted changes
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 2: Creating Test Files (Uncommitted Changes)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create untracked files
echo "Test content - created $(date)" > test-untracked-1.txt
echo "Another test file - $(date)" > test-untracked-2.txt

# Modify existing file
if [ -f "package.json" ]; then
    echo "// Test modification at $(date)" >> package.json
fi

log_success "Created test files:"
log_info "  • test-untracked-1.txt (new untracked)"
log_info "  • test-untracked-2.txt (new untracked)"
if [ -f "package.json" ]; then
    log_info "  • package.json (modified)"
fi

# Show git status again
echo ""
git status --short
echo ""

# Step 3: Demonstrate backup creation
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 3: Testing Backup Function"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create backup using git stash
log_info "Creating backup using git stash..."
backup_timestamp=$(date +"%Y%m%d_%H%M%S")
backup_dir=".backup/${backup_timestamp}"
mkdir -p ".backup"

git stash push -u -m "Test backup at ${backup_timestamp}" --include-untracked

if [ $? -eq 0 ]; then
    stash_ref=$(git stash list -n 1 --format="%H")
    log_success "Backup created successfully!"
    log_info "  • Stash reference: $stash_ref"
    log_info "  • Backup timestamp: $backup_timestamp"

    # Save backup info
    echo "Backup created at: $(date)" >> ".backup/backup.log"
    echo "Backup directory: $backup_dir" >> ".backup/backup.log"
    echo "Git stash reference: $stash_ref" >> ".backup/backup.log"
else
    log_warning "No changes to backup"
    # Create log file anyway
    touch ".backup/backup.log"
fi

# Show clean status after stash
echo ""
git status --short
echo ""

# Step 4: Show available backups
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 4: Available Backups"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f ".backup/backup.log" ]; then
    cat ".backup/backup.log"
fi

echo ""
log_info "Git Stashes:"
git stash list
echo ""

# Step 5: Demonstrate restore
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 5: Testing Backup Restore"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

read -p "Do you want to restore the backup? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Restoring from backup..."
    git stash pop

    log_success "Backup restored!"
    echo ""
    git status --short
    echo ""

    log_success "Restored files:"
    ls -la test-untracked-*.txt 2>/dev/null || log_info "No test files found"
else
    log_info "Skipping restore test"
fi

# Step 6: Test --hard flag simulation
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 6: Testing --hard Flag with build.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

log_info "You can test the --hard flag with:"
echo "  ./scripts/build.sh build --hard"
echo ""
log_info "This will:"
echo "  • Detect uncommitted changes"
echo "  • Create automatic backup"
echo "  • Prompt for confirmation"
echo "  • Perform hard reset after confirmation"
echo ""

# Step 7: Cleanup options
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 7: Cleanup Options"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

log_info "To clean up test files:"
echo "  rm test-untracked-*.txt"
echo ""
log_info "To remove the backup stash:"
echo "  git stash drop"
echo ""
log_info "To clean all backups:"
echo "  rm -rf .backup/"
echo ""

log_success "Demo completed!"
echo ""
echo "Key Features Demonstrated:"
echo "  ✓ Automatic backup creation with git stash"
echo "  ✓ Backup logging in .backup/ directory"
echo "  ✓ User confirmation before destructive operations"
echo "  ✓ Easy restore using git stash pop"
echo "  ✓ Clean workspace management"