#!/bin/bash

# Test script to simulate the publish flow without actually publishing

set -e

echo "Testing publish flow (simulation)..."
echo ""

# Source the build script functions
source ./scripts/build.sh

# Test 1: Check vsce authentication
echo "1. Testing VSCE authentication check..."
if check_vsce_auth; then
    echo "✓ Already authenticated"
else
    echo "✗ Not authenticated (expected for test)"
fi

# Test 2: Build and package
echo ""
echo "2. Testing build and package..."
do_build
do_package

# Test 3: Check if package exists
if [ -f "vibe-code-guardian-$(jq -r '.version' package.json).vsix" ]; then
    echo "✓ Package created successfully"
else
    echo "✗ Package creation failed"
    exit 1
fi

# Test 4: Check zed directory (if exists)
if [ -d "zed" ]; then
    echo ""
    echo "4. Checking zed extension..."
    if [ -f "zed/extension.toml" ]; then
        echo "✓ Zed extension.toml exists"
        echo "   Version: $(grep -o 'version = "[^"]*"' zed/extension.toml | cut -d'"' -f2)"
    fi
    if [ -f "zed/Cargo.toml" ]; then
        echo "✓ Zed Cargo.toml exists"
        echo "   Version: $(grep -o 'version = "[^"]*"' zed/Cargo.toml | cut -d'"' -f2)"
    fi
fi

echo ""
echo "Publish flow test completed successfully!"
echo ""
echo "Next steps to publish to VS Code Marketplace:"
echo ""
echo "1. Get a Personal Access Token (PAT) from:"
echo "   https://marketplace.visualstudio.com/manage/publishers/vibe-coder"
echo ""
echo "2. Set the PAT (choose one method):"
echo "   a) Environment variable: export VSCE_PAT='your_token_here'"
echo "   b) Interactive prompt (script will ask)"
echo ""
echo "3. Run the actual publish:"
echo "   ./scripts/build.sh publish"
echo ""
echo "Or with version bump:"
echo "   ./scripts/build.sh full patch"