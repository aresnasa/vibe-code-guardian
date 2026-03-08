#!/bin/bash

# Test script for VSCE authentication improvements

set -e

echo "Testing VSCE authentication..."
echo ""

# Test 1: Check if vsce is installed
if command -v vsce &> /dev/null; then
    echo "✓ VSCE is installed: $(vsce --version)"
else
    echo "✗ VSCE is not installed"
    exit 1
fi

# Test 2: Check current authentication status
echo ""
echo "Checking current authentication status..."
if vsce whoami &> /dev/null; then
    echo "✓ Currently authenticated as: $(vsce whoami)"
else
    echo "✗ Not currently authenticated"
fi

# Test 3: Check VSCE_PAT environment variable
echo ""
echo "Checking VSCE_PAT environment variable..."
if [ -n "$VSCE_PAT" ]; then
    echo "✓ VSCE_PAT is set"
    # Check if it's a valid token (basic check)
    if [[ "$VSCE_PAT" =~ ^[a-zA-Z0-9_-]{40,}$ ]]; then
        echo "✓ VSCE_PAT appears to be a valid token"
    else
        echo "⚠ VSCE_PAT doesn't look like a valid token"
    fi
else
    echo "✗ VSCE_PAT is not set"
    echo "You can set it with: export VSCE_PAT='your_token_here'"
fi

# Test 4: Test package creation
echo ""
echo "Testing package creation..."
./scripts/build.sh package

if [ -f "vibe-code-guardian-$(jq -r '.version' package.json).vsix" ]; then
    echo "✓ Package created successfully"
else
    echo "✗ Package creation failed"
    exit 1
fi

echo ""
echo "Authentication test completed!"
echo ""
echo "To publish to VS Code Marketplace:"
echo "1. Get a PAT from: https://marketplace.visualstudio.com/manage/publishers/vibe-coder"
echo "2. Set the token: export VSCE_PAT='your_token_here'"
echo "3. Run: ./scripts/build.sh publish"