#!/bin/bash
# Badria PWA - Clean Install Script
# Run this instead of bench get-app

BENCH_PATH="${1:-~/fifteen-bench}"
SITE="${2:-}"

echo "🚀 Badria PWA Clean Installer"
echo "================================"

# Expand tilde
BENCH_PATH="${BENCH_PATH/#\~/$HOME}"

# Step 1: Clean old installations
echo "Step 1: Removing old installations..."
rm -rf "$BENCH_PATH/apps/badria_pwa" 2>/dev/null && echo "  ✅ Removed apps/badria_pwa"
rm -rf "$BENCH_PATH/apps/Badria-PWA" 2>/dev/null && echo "  ✅ Removed apps/Badria-PWA"
rm -rf "$BENCH_PATH/archived/apps/badria_pwa"* 2>/dev/null && echo "  ✅ Removed archived"

# Step 2: Remove from pip
echo "Step 2: Removing old pip registration..."
"$BENCH_PATH/env/bin/pip" uninstall badria_pwa -y 2>/dev/null && echo "  ✅ Removed from pip"
"$BENCH_PATH/env/bin/pip" uninstall Badria-PWA -y 2>/dev/null && echo "  ✅ Removed Badria-PWA from pip"

# Step 3: Clone directly
echo "Step 3: Cloning app..."
cd "$BENCH_PATH/apps"
git clone https://github.com/NehaFathimap/badria_pwa.git --branch develop --depth 1
echo "  ✅ Cloned successfully"

# Step 4: Install via pip
echo "Step 4: Installing package..."
"$BENCH_PATH/env/bin/pip" install -e "$BENCH_PATH/apps/badria_pwa"
echo "  ✅ Package installed"

# Step 5: Install on site if provided
if [ -n "$SITE" ]; then
    echo "Step 5: Installing on site $SITE..."
    cd "$BENCH_PATH"
    bench --site "$SITE" install-app badria_pwa
    bench build --app badria_pwa
    bench restart
    echo "  ✅ Done!"
else
    echo ""
    echo "Now run:"
    echo "  cd $BENCH_PATH"
    echo "  bench --site YOUR-SITE install-app badria_pwa"
    echo "  bench build --app badria_pwa"
    echo "  bench restart"
fi
