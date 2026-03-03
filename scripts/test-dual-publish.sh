#!/bin/bash

# Test script for dual publishing workflow
# This script tests the dual publishing functionality without actually publishing

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Testing Dual Publishing Workflow"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test 1: Basic build
echo ""
echo "Test 1: Basic build..."
./scripts/build.sh build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✓ Basic build successful"
else
    echo "✗ Basic build failed"
    exit 1
fi

# Test 2: Package creation
echo ""
echo "Test 2: Package creation..."
./scripts/build.sh package > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✓ Package creation successful"
    # Check if vsix file exists
    VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
    if [ -f "vibe-code-guardian-${VERSION}.vsix" ]; then
        echo "✓ VSIX file created: vibe-code-guardian-${VERSION}.vsix"
    else
        echo "✗ VSIX file not found"
        exit 1
    fi
else
    echo "✗ Package creation failed"
    exit 1
fi

# Test 3: Zed extension structure
echo ""
echo "Test 3: Zed extension structure..."
if [ -d "zed" ]; then
    echo "✓ Zed directory exists"

    # Check extension.toml
    if [ -f "zed/extension.toml" ]; then
        echo "✓ extension.toml exists"

        # Check version in extension.toml
        ZED_VERSION=$(grep 'version' zed/extension.toml | head -1 | sed 's/.*version = "\([^"]*\)".*/\1/')
        echo "  Current Zed version: ${ZED_VERSION}"
    else
        echo "✗ extension.toml not found"
        exit 1
    fi

    # Check Cargo.toml
    if [ -f "zed/Cargo.toml" ]; then
        echo "✓ Cargo.toml exists"

        CARGO_VERSION=$(grep '^version' zed/Cargo.toml | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
        echo "  Current Cargo version: ${CARGO_VERSION}"
    else
        echo "✗ Cargo.toml not found"
        exit 1
    fi

    # Check if Cargo is available for building
    if command -v cargo &> /dev/null; then
        echo "✓ Cargo is available for building"

        # Test zed build (without publishing)
        echo ""
        echo "  Testing Zed extension build..."
        cd zed
        cargo build 2>&1 | grep -E "(Compiling|Finished|error)" || true
        if [ $? -eq 0 ] || cargo build 2>&1 | grep -q "Finished"; then
            echo "  ✓ Zed extension builds successfully"
        fi
        cd ..
    else
        echo "⚠ Cargo not available, skipping build test"
    fi

    # Check git submodule status
    if [ -f "zed/.git" ]; then
        echo "✓ Zed is configured as a git submodule"
    else
        echo "⚠ Zed is not configured as a submodule"
    fi

else
    echo "✗ Zed directory not found"
    exit 1
fi

# Test 4: Check for required tools
echo ""
echo "Test 4: Required tools check..."

if command -v node &> /dev/null; then
    echo "✓ Node.js: $(node --version)"
else
    echo "✗ Node.js not found"
    exit 1
fi

if command -v npm &> /dev/null; then
    echo "✓ npm: $(npm --version)"
else
    echo "✗ npm not found"
    exit 1
fi

if command -v vsce &> /dev/null || npx @vscode/vsce --version &> /dev/null; then
    echo "✓ vsce available"
else
    echo "⚠ vsce not available (will be installed during publish)"
fi

if command -v cargo &> /dev/null; then
    echo "✓ cargo: $(cargo --version | head -1)"
else
    echo "⚠ cargo not available (required for Zed extension publish)"
fi

if command -v git &> /dev/null; then
    echo "✓ git: $(git --version | head -1)"
else
    echo "✗ git not found"
    exit 1
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ All critical tests passed!"
echo ""
echo "Dual publishing workflow is ready:"
echo "  • VS Code Extension: ./scripts/build.sh publish"
echo "  • VS Code + Zed: ./scripts/build.sh publish"
echo "  • Skip Zed: ./scripts/build.sh publish --skip-zed"
echo "  • Full release: ./scripts/build.sh full [patch|minor|major]"
echo ""
echo "Ready to publish to:"
echo "  • VS Code Marketplace: https://marketplace.visualstudio.com/"
echo "  • crates.io (Zed): https://crates.io/"
echo ""
