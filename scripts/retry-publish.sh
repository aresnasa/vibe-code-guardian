#!/bin/bash

# Retry publish script with improved error handling
# This script provides multiple retry options for publishing

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

VERSION=$(jq -r '.version' package.json)
MAX_RETRIES=3
RETRY_DELAY=10

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 VS Code Marketplace Publish with Retry"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log_info "Version: $VERSION"
log_info "Max Retries: $MAX_RETRIES"
log_info "Retry Delay: ${RETRY_DELAY}s"
echo ""

# Check if package exists
if [ ! -f "vibe-code-guardian-${VERSION}.vsix" ]; then
    log_error "Package not found: vibe-code-guardian-${VERSION}.vsix"
    log_info "Building package first..."
    ./scripts/build.sh package
fi

# Check authentication
if [ -z "$VSCE_PAT" ]; then
    log_warning "VSCE_PAT not set"
    read -p "Enter your VS Code Marketplace PAT (or press Enter to skip): " -r
    if [ -n "$REPLY" ]; then
        export VSCE_PAT="$REPLY"
        log_success "PAT set for this session"
    else
        log_info "Skipping PAT input - publish may fail"
    fi
fi

# Function to try publishing
try_publish() {
    local attempt=$1
    log_info "Attempt $attempt of $MAX_RETRIES..."

    if [ -n "$VSCE_PAT" ]; then
        # Using PAT
        echo "$VSCE_PAT" | npx @vscode/vsce publish
    else
        # Interactive login
        npx @vscode/vsce login vibe-coder --pat
        npx @vscode/vsce publish
    fi

    return $?
}

# Try publishing with retries
for attempt in $(seq 1 $MAX_RETRIES); do
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "Publishing Attempt $attempt/$MAX_RETRIES"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if try_publish $attempt; then
        log_success "✓ Publish successful on attempt $attempt!"
        echo ""
        log_info "Extension URL: https://marketplace.visualstudio.com/items?itemName=vibe-coder.vibe-code-guardian"
        exit 0
    else
        EXIT_CODE=$?
        log_warning "⚠ Attempt $attempt failed with exit code: $EXIT_CODE"

        if [ $attempt -lt $MAX_RETRIES ]; then
            log_info "Waiting ${RETRY_DELAY}s before retry..."
            sleep $RETRY_DELAY
        fi
    fi
done

# All retries failed
echo ""
log_error "❌ All $MAX_RETRIES publish attempts failed"
echo ""
log_info "Possible solutions:"
echo ""
echo "1. Check your internet connection"
echo "   ping marketplace.visualstudio.com"
echo ""
echo "2. Verify your PAT is valid and has correct permissions"
echo "   Visit: https://marketplace.visualstudio.com/manage/publishers/vibe-coder"
echo ""
echo "3. Try manual upload"
echo "   Visit: https://marketplace.visualstudio.com/manage"
echo "   Upload: vibe-code-guardian-${VERSION}.vsix"
echo ""
echo "4. Check VS Code Marketplace status"
echo "   Visit: https://dev.azure.com"
echo ""
log_info "Package file: vibe-code-guardian-${VERSION}.vsix"
exit 1