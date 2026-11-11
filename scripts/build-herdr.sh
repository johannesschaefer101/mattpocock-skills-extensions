#!/bin/sh
# Writes herdr/tickets/tickets.js, the herdr pane's copy of the ticket logic, from hooks/tickets.ts.
set -e
cd "$(dirname "$0")/.."
out=$(mktemp -d)
npx -y -p typescript tsc hooks/tickets.ts --target es2022 --module es2022 --skipLibCheck --ignoreConfig --outDir "$out"
{ echo "// Generated from hooks/tickets.ts by scripts/build-herdr.sh. Do not edit."; cat "$out/tickets.js"; } > herdr/tickets/tickets.js
rm -rf "$out"
