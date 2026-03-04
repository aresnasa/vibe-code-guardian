#!/bin/bash

# Test script for dual-platform publishing
# This will verify all prerequisites and guide you through the publishing process

set -e

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

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Dual-Platform Publishing Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get current version
VERSION=$(jq -r '.version' package.json)
log_info "Current version: $VERSION"
echo ""

# Check 1: Verify .vsix package exists
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 1: Verify Package Files"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "vibe-code-guardian-${VERSION}.vsix" ]; then
    log_success "✓ VS Code package found: vibe-code-guardian-${VERSION}.vsix"
    SIZE=$(ls -lh "vibe-code-guardian-${VERSION}.vsix" | awk '{print $5}')
    log_info "  Package size: $SIZE"
else
    log_warning "⚠ Package not found, will build during publish"
fi

# Check 2: Verify package content
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 2: Verify Package Content"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Use vsce to list package files
npx @vscode/vsce ls --tree 2>/dev/null | head -15

# Check for test files
if npx @vscode/vsce ls 2>/dev/null | grep -q "test-"; then
    log_warning "⚠ Test files found in package!"
else
    log_success "✓ No test files in package"
fi

# Check for internal docs
if npx @vscode/vsce ls 2>/dev/null | grep -q "CLAUDE.md\|DUAL_PUBLISHING"; then
    log_warning "⚠ Internal docs found in package!"
else
    log_success "✓ No internal docs in package"
fi

echo ""

# Check 3: Verify Zed extension
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 3: Verify Zed Extension"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -d "zed" ]; then
    log_success "✓ Zed directory exists"

    if [ -f "zed/extension.toml" ]; then
        log_success "✓ extension.toml found"
        ZED_VERSION=$(grep -o 'version = "[^"]*"' zed/extension.toml | cut -d'"' -f2)
        log_info "  Version: $ZED_VERSION"
    else
        log_warning "⚠ extension.toml not found"
    fi

    if [ -f "zed/Cargo.toml" ]; then
        log_success "✓ Cargo.toml found"
        CARGO_VERSION=$(grep -o 'version = "[^"]*"' zed/Cargo.toml | cut -d'"' -f2)
        log_info "  Version: $CARGO_VERSION"
    else
        log_warning "⚠ Cargo.toml not found"
    fi

    # Check if Cargo is available
    if command -v cargo &> /dev/null; then
        log_success "✓ Cargo is installed"
        CARGO_VERSION_FULL=$(cargo --version)
        log_info "  $CARGO_VERSION_FULL"
    else
        log_warning "⚠ Cargo not installed - Zed publishing will fail"
    fi
else
    log_warning "⚠ Zed directory not found - use --skip-zed flag"
fi

echo ""

# Check 4: Verify build.sh
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 4: Verify build.sh Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "scripts/build.sh" ]; then
    log_success "✓ build.sh exists"

    # Check for --hard flag support
    if grep -q '--hard' scripts/build.sh; then
        log_success "✓ --hard flag supported"
    fi

    # Check for --skip-zed flag support
    if grep -q '--skip-zed' scripts/build.sh; then
        log_success "✓ --skip-zed flag supported"
    fi

    # Check for authentication functions
    if grep -q 'check_vsce_auth' scripts/build.sh; then
        log_success "✓ Authentication functions present"
    fi
else
    log_error "✗ build.sh not found"
fi

echo ""

# Check 5: Check authentication status
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Step 5: Authentication Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check VSCE PAT
if [ -n "$VSCE_PAT" ]; then
    log_success "✓ VSCE_PAT environment variable is set"
else
    log_warning "⚠ VSCE_PAT not set - you will be prompted during publish"
fi

# Check Cargo auth
if [ -f ~/.cargo/credentials ]; then
    log_success "✓ Cargo credentials configured"
else
    log_warning "⚠ Cargo credentials not configured - run 'cargo login'"
fi

echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Publishing Readiness Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log_info "Extension Information:"
echo "  • Version: $VERSION"
echo "  • Publisher: vibe-coder"
echo "  • VS Code ID: vibe-coder.vibe-code-guardian"
echo "  • Zed Package: vibe-code-guardian"
echo ""
log_info "Marketplace URLs:"
echo "  • VS Code: https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian"
echo "  • Zed: https://crates.io/crates/vibe-code-guardian"
echo ""
log_info "Next Steps:"
echo "  1. Get VS Code Marketplace PAT:"
echo "     https://marketplace.visualstudio.com/manage/publishers/vibe-coder"
echo ""
echo "  2. Configure Cargo (for Zed):"
echo "     cargo login"
echo ""
echo "  3. Execute publish command:"
echo "     ./scripts/build.sh publish"
echo ""
echo "Options:"
echo "  • --skip-zed    Skip Zed publishing"
echo "  • --hard        Force clean build with backup"
echo ""
log_info "For detailed instructions, see PUBLISH-GUIDE.md"
echo ""

# Interactive prompt
read -p "Do you want to try publishing now? (y/n): " -n 1 -r
echo
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Starting publish process..."
    echo ""
    ./scripts/build.sh publish
else
    log_info "Publish cancelled. Run './scripts/build.sh publish' when ready."
fi

echo ""
log_success "Test completed!"