#!/bin/bash

# Vibe Code Guardian - Build Script
# This script compiles the project and prepares it for packaging

set -e  # Exit on error

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "🔨 Building Vibe Code Guardian..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Check Node.js installation
echo "✓ Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi
echo "  Node.js version: $(node --version)"

# Step 2: Check npm installation
echo "✓ Checking npm..."
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi
echo "  npm version: $(npm --version)"

# Step 3: Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "✓ Installing dependencies..."
    npm install
else
    echo "✓ Dependencies already installed"
fi

# Step 4: Check TypeScript types
echo "✓ Type checking..."
npm run check-types

# Step 5: Linting
echo "✓ Running linter..."
npm run lint

# Step 6: Build with esbuild
echo "✓ Bundling with esbuild..."
node esbuild.js

# Step 7: Verify output
echo "✓ Verifying build..."
if [ -f "dist/extension.js" ]; then
    echo "  dist/extension.js - OK ($(du -h dist/extension.js | cut -f1))"
else
    echo "❌ Build output not found: dist/extension.js"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Build completed successfully!"
echo ""
echo "📦 To package for distribution, run:"
echo "   npm run package"
echo ""
echo "🧪 To run tests, use:"
echo "   npm test"
