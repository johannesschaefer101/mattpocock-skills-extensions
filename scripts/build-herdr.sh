#!/bin/sh
# Writes to-tickets/herdr/tickets/tickets.js, the herdr pane's copy of the ticket logic, from to-tickets/hooks/tickets.ts.
set -e
cd "$(dirname "$0")/.."
out=$(mktemp -d)
npx -y -p typescript tsc to-tickets/hooks/tickets.ts --target es2022 --module es2022 --skipLibCheck --ignoreConfig --outDir "$out"
{ echo "// Generated from to-tickets/hooks/tickets.ts by scripts/build-herdr.sh. Do not edit."; cat "$out/tickets.js"; } > to-tickets/herdr/tickets/tickets.js
rm -rf "$out"
