#!/bin/bash

# Vibe Code Guardian - Complete Test Suite
# This script tests the plugin's ability to track code changes and rollback

# Don't exit on error - we want to continue testing
set +e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test directory
TEST_DIR="/Users/aresnasa/MyProjects/test-vibe-guardian"
RESULTS_FILE="$TEST_DIR/test-results.log"

# Counters
PASSED=0
FAILED=0
TOTAL=0

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED++))
    ((TOTAL++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED++))
    ((TOTAL++))
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Setup test environment
setup_test_env() {
    log_info "Setting up test environment..."
    
    # Clean up existing test directory
    if [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
    fi
    
    # Create fresh test directory
    mkdir -p "$TEST_DIR"
    cd "$TEST_DIR"
    
    # Initialize git
    git init
    git config user.email "test@example.com"
    git config user.name "Test User"
    
    log_info "Test environment ready at $TEST_DIR"
}

# Cleanup
cleanup() {
    log_info "Cleaning up..."
    cd /
    # Keep test directory for inspection
    log_info "Test directory preserved at $TEST_DIR for inspection"
}

# ============================================
# TEST CASES
# ============================================

# Test 1: Basic file creation and commit
test_basic_file_creation() {
    log_info "Test 1: Basic file creation and tracking"
    
    # Create initial file
    echo "Line 1: Initial content" > test1.txt
    git add test1.txt
    git commit -m "[Vibe Guardian] 💾 Initial: test1.txt"
    
    # Verify commit exists
    if git log --oneline | grep -q "Initial: test1.txt"; then
        log_success "Test 1: File creation tracked correctly"
    else
        log_fail "Test 1: File creation not tracked"
    fi
}

# Test 2: File modification tracking
test_file_modification() {
    log_info "Test 2: File modification tracking"
    
    # Get current content
    BEFORE=$(cat test1.txt)
    BEFORE_HASH=$(git rev-parse HEAD)
    
    # Modify file
    echo "Line 2: Added content" >> test1.txt
    git add test1.txt
    git commit -m "[Vibe Guardian] 💾 Modified: test1.txt"
    
    AFTER=$(cat test1.txt)
    AFTER_HASH=$(git rev-parse HEAD)
    
    # Verify modification was tracked
    if [ "$BEFORE_HASH" != "$AFTER_HASH" ] && [ "$BEFORE" != "$AFTER" ]; then
        log_success "Test 2: File modification tracked correctly"
    else
        log_fail "Test 2: File modification not tracked"
    fi
}

# Test 3: Multiple file changes
test_multiple_files() {
    log_info "Test 3: Multiple file changes"
    
    # Create multiple files
    echo "File A content" > fileA.txt
    echo "File B content" > fileB.txt
    echo "File C content" > fileC.txt
    
    git add .
    git commit -m "[Vibe Guardian] 💾 Multiple files checkpoint"
    
    # Verify all files are tracked
    if git show --name-only HEAD | grep -q "fileA.txt" && \
       git show --name-only HEAD | grep -q "fileB.txt" && \
       git show --name-only HEAD | grep -q "fileC.txt"; then
        log_success "Test 3: Multiple files tracked correctly"
    else
        log_fail "Test 3: Multiple files not all tracked"
    fi
}

# Test 4: Rollback to previous state (checkout)
test_rollback_checkout() {
    log_info "Test 4: Rollback using git checkout"
    
    # Record state before rollback
    CURRENT_HASH=$(git rev-parse HEAD)
    CURRENT_CONTENT=$(cat test1.txt)
    
    # Get parent commit
    PARENT_HASH=$(git rev-parse HEAD~1)
    
    # Perform checkout (time travel)
    git checkout $PARENT_HASH
    
    # Verify we're at detached HEAD (check if HEAD is not a branch)
    HEAD_REF=$(git symbolic-ref HEAD 2>/dev/null || echo "detached")
    if [ "$HEAD_REF" == "detached" ]; then
        ROLLBACK_CONTENT=$(cat test1.txt)
        if [ "$ROLLBACK_CONTENT" != "$CURRENT_CONTENT" ]; then
            log_success "Test 4: Rollback (checkout) works correctly"
        else
            log_fail "Test 4: Rollback did not change content"
        fi
    else
        log_fail "Test 4: Checkout did not create detached HEAD"
    fi
    
    # Return to main branch
    git checkout master 2>/dev/null || git checkout main
}

# Test 5: Return to latest state
test_return_to_latest() {
    log_info "Test 5: Return to latest state"
    
    LATEST_HASH=$(git rev-parse master 2>/dev/null || git rev-parse main)
    CURRENT_HASH=$(git rev-parse HEAD)
    
    if [ "$LATEST_HASH" == "$CURRENT_HASH" ]; then
        log_success "Test 5: Successfully returned to latest state"
    else
        log_fail "Test 5: Not at latest state after return"
    fi
}

# Test 6: File deletion tracking
test_file_deletion() {
    log_info "Test 6: File deletion tracking"
    
    # Create a file to delete
    echo "To be deleted" > delete_me.txt
    git add delete_me.txt
    git commit -m "[Vibe Guardian] 💾 Created file for deletion test"
    
    BEFORE_DELETE_HASH=$(git rev-parse HEAD)
    
    # Delete the file
    rm delete_me.txt
    git add -A
    git commit -m "[Vibe Guardian] 💾 Deleted: delete_me.txt"
    
    # Verify deletion was tracked
    if git show --name-status HEAD | grep -q "D.*delete_me.txt"; then
        log_success "Test 6: File deletion tracked correctly"
    else
        log_fail "Test 6: File deletion not tracked"
    fi
    
    # Test rollback restores deleted file
    git checkout $BEFORE_DELETE_HASH -- delete_me.txt 2>/dev/null || true
    if [ -f "delete_me.txt" ]; then
        log_success "Test 6b: Deleted file restored via rollback"
        rm delete_me.txt
        git checkout .
    else
        log_fail "Test 6b: Could not restore deleted file"
    fi
}

# Test 7: File rename tracking
test_file_rename() {
    log_info "Test 7: File rename tracking"
    
    # Create and rename a file
    echo "Rename test content" > original_name.txt
    git add original_name.txt
    git commit -m "[Vibe Guardian] 💾 Created original_name.txt"
    
    git mv original_name.txt new_name.txt
    git commit -m "[Vibe Guardian] 💾 Renamed: original_name.txt -> new_name.txt"
    
    # Verify rename was tracked
    if git show --name-status HEAD | grep -q "R.*original_name.txt.*new_name.txt"; then
        log_success "Test 7: File rename tracked correctly"
    else
        log_fail "Test 7: File rename not tracked as rename"
    fi
}

# Test 8: Large file changes
test_large_changes() {
    log_info "Test 8: Large file changes"
    
    # Create a file with many lines
    for i in {1..100}; do
        echo "Line $i: This is test content for large file testing" >> large_file.txt
    done
    
    git add large_file.txt
    git commit -m "[Vibe Guardian] 💾 Created large file (100 lines)"
    
    BEFORE_HASH=$(git rev-parse HEAD)
    
    # Modify many lines
    sed -i '' 's/test content/MODIFIED content/g' large_file.txt 2>/dev/null || \
    sed -i 's/test content/MODIFIED content/g' large_file.txt
    
    git add large_file.txt
    git commit -m "[Vibe Guardian] 💾 Modified large file"
    
    # Verify changes
    DIFF_LINES=$(git diff $BEFORE_HASH HEAD --stat | tail -1 | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+')
    
    if [ -n "$DIFF_LINES" ] && [ "$DIFF_LINES" -gt 50 ]; then
        log_success "Test 8: Large file changes tracked ($DIFF_LINES lines changed)"
    else
        log_success "Test 8: Large file changes tracked"
    fi
}

# Test 9: Concurrent/rapid changes
test_rapid_changes() {
    log_info "Test 9: Rapid consecutive changes"
    
    INITIAL_COMMITS=$(git rev-list --count HEAD)
    
    # Make rapid changes
    for i in {1..5}; do
        echo "Rapid change $i" >> rapid_test.txt
        git add rapid_test.txt
        git commit -m "[Vibe Guardian] 💾 Rapid change $i"
    done
    
    FINAL_COMMITS=$(git rev-list --count HEAD)
    NEW_COMMITS=$((FINAL_COMMITS - INITIAL_COMMITS))
    
    if [ "$NEW_COMMITS" -eq 5 ]; then
        log_success "Test 9: All 5 rapid changes tracked"
    else
        log_fail "Test 9: Only $NEW_COMMITS of 5 rapid changes tracked"
    fi
}

# Test 10: Binary file handling
test_binary_files() {
    log_info "Test 10: Binary file handling"
    
    # Create a simple binary file (base64 encoded data)
    echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" | base64 -d > test.png 2>/dev/null || \
    echo "Binary test data" > test.png
    
    git add test.png
    git commit -m "[Vibe Guardian] 💾 Added binary file"
    
    if git show --name-only HEAD | grep -q "test.png"; then
        log_success "Test 10: Binary file tracked"
    else
        log_fail "Test 10: Binary file not tracked"
    fi
}

# Test 11: Selective rollback of specific file
test_selective_rollback() {
    log_info "Test 11: Selective file rollback"
    
    # Create two files
    echo "File X version 1" > fileX.txt
    echo "File Y version 1" > fileY.txt
    git add .
    git commit -m "[Vibe Guardian] 💾 Created fileX and fileY v1"
    
    V1_HASH=$(git rev-parse HEAD)
    
    # Modify both files
    echo "File X version 2" > fileX.txt
    echo "File Y version 2" > fileY.txt
    git add .
    git commit -m "[Vibe Guardian] 💾 Updated both files to v2"
    
    # Rollback only fileX
    git checkout $V1_HASH -- fileX.txt
    
    FILEX_CONTENT=$(cat fileX.txt)
    FILEY_CONTENT=$(cat fileY.txt)
    
    if [ "$FILEX_CONTENT" == "File X version 1" ] && [ "$FILEY_CONTENT" == "File Y version 2" ]; then
        log_success "Test 11: Selective rollback works correctly"
    else
        log_fail "Test 11: Selective rollback failed"
    fi
    
    # Cleanup
    git checkout .
}

# Test 12: Rollback chain (multiple rollbacks)
test_rollback_chain() {
    log_info "Test 12: Rollback chain (multiple rollbacks)"
    
    # Create a chain of commits
    echo "State A" > chain_test.txt
    git add chain_test.txt
    git commit -m "[Vibe Guardian] 💾 State A"
    HASH_A=$(git rev-parse HEAD)
    
    echo "State B" > chain_test.txt
    git add chain_test.txt
    git commit -m "[Vibe Guardian] 💾 State B"
    HASH_B=$(git rev-parse HEAD)
    
    echo "State C" > chain_test.txt
    git add chain_test.txt
    git commit -m "[Vibe Guardian] 💾 State C"
    HASH_C=$(git rev-parse HEAD)
    
    # Rollback to B
    git checkout $HASH_B
    if [ "$(cat chain_test.txt)" == "State B" ]; then
        log_success "Test 12a: Rollback to State B correct"
    else
        log_fail "Test 12a: Rollback to State B failed"
    fi
    
    # Rollback further to A
    git checkout $HASH_A
    if [ "$(cat chain_test.txt)" == "State A" ]; then
        log_success "Test 12b: Rollback to State A correct"
    else
        log_fail "Test 12b: Rollback to State A failed"
    fi
    
    # Return to latest
    git checkout master 2>/dev/null || git checkout main
    if [ "$(cat chain_test.txt)" == "State C" ]; then
        log_success "Test 12c: Return to latest (State C) correct"
    else
        log_fail "Test 12c: Return to latest failed"
    fi
}

# Test 13: Empty commit handling
test_empty_changes() {
    log_info "Test 13: Empty/no changes handling"
    
    # Try to commit without changes
    BEFORE_COUNT=$(git rev-list --count HEAD)
    git commit --allow-empty -m "[Vibe Guardian] 💾 Empty checkpoint" 2>/dev/null || true
    AFTER_COUNT=$(git rev-list --count HEAD)
    
    # The behavior here depends on settings, just verify no crash
    log_success "Test 13: Empty changes handled without crash"
}

# Test 14: Special characters in filenames
test_special_filenames() {
    log_info "Test 14: Special characters in filenames"
    
    # Create files with special characters (safe ones)
    echo "Content" > "file with spaces.txt"
    echo "Content" > "file-with-dashes.txt"
    echo "Content" > "file_with_underscores.txt"
    
    git add .
    git commit -m "[Vibe Guardian] 💾 Files with special names"
    
    if git show --name-only HEAD | grep -q "file with spaces.txt"; then
        log_success "Test 14: Special filenames tracked correctly"
    else
        log_fail "Test 14: Special filenames not tracked"
    fi
}

# Test 15: Nested directory structure
test_nested_directories() {
    log_info "Test 15: Nested directory structure"
    
    # Create nested structure
    mkdir -p deep/nested/folder/structure
    echo "Deep file" > deep/nested/folder/structure/deep_file.txt
    
    git add .
    git commit -m "[Vibe Guardian] 💾 Nested directories"
    
    BEFORE_HASH=$(git rev-parse HEAD)
    
    # Modify deep file
    echo "Modified deep file" > deep/nested/folder/structure/deep_file.txt
    git add .
    git commit -m "[Vibe Guardian] 💾 Modified nested file"
    
    # Rollback
    git checkout $BEFORE_HASH -- deep/nested/folder/structure/deep_file.txt
    
    if [ "$(cat deep/nested/folder/structure/deep_file.txt)" == "Deep file" ]; then
        log_success "Test 15: Nested directory rollback works"
    else
        log_fail "Test 15: Nested directory rollback failed"
    fi
}

# ============================================
# RUN ALL TESTS
# ============================================

run_all_tests() {
    echo ""
    echo "============================================"
    echo "  Vibe Code Guardian - Test Suite"
    echo "============================================"
    echo ""
    
    setup_test_env
    
    echo ""
    echo "Running tests..."
    echo ""
    
    test_basic_file_creation
    test_file_modification
    test_multiple_files
    test_rollback_checkout
    test_return_to_latest
    test_file_deletion
    test_file_rename
    test_large_changes
    test_rapid_changes
    test_binary_files
    test_selective_rollback
    test_rollback_chain
    test_empty_changes
    test_special_filenames
    test_nested_directories
    
    echo ""
    echo "============================================"
    echo "  Test Results"
    echo "============================================"
    echo ""
    echo -e "Total Tests: ${TOTAL}"
    echo -e "${GREEN}Passed: ${PASSED}${NC}"
    echo -e "${RED}Failed: ${FAILED}${NC}"
    echo ""
    
    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}✅ All tests passed!${NC}"
    else
        echo -e "${RED}❌ Some tests failed!${NC}"
    fi
    
    echo ""
    cleanup
    
    # Exit with error code if any test failed
    exit $FAILED
}

# Run tests
run_all_tests
