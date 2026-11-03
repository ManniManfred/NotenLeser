#!/bin/sh
# Builds build/notenleser-<version>.tar.gz, ready to be extracted into Nextcloud's apps folder.
set -e
cd "$(dirname "$0")/.."
version=$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' appinfo/info.xml)
rm -rf build && mkdir -p build/notenleser
cp -r appinfo lib templates css img fonts js build/notenleser/
cp README.md build/notenleser/ 2>/dev/null || true
cp -r ../LICENSE ../THIRD-PARTY-NOTICES.md ../LICENSES build/notenleser/
rm -f build/notenleser/js/*.map build/notenleser/js/notenleser-standalone.js*
tar -czf "build/notenleser-$version.tar.gz" -C build notenleser
echo "build/notenleser-$version.tar.gz"
