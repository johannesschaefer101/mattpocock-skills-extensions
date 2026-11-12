#!/bin/sh
# Writes the generated files of each herdr pane: its copy of its plugin's logic
# (to-tickets/herdr/tickets/tickets.js from to-tickets/hooks/tickets.ts, and
# wayfinder/herdr/wayfinder/{tracker,launch}.js from wayfinder/hooks), and board.js, the pane both
# are built on, from scripts/herdr/board.js. A mod is a plain folder of files, so each gets a copy.
set -e
cd "$(dirname "$0")/.."
out=$(mktemp -d)
# build <plugin folder> <mod name> <file>...: the .ts files of the plugin's hooks, compiled into the mod.
build() {
  plugin=$1 mod=$2; shift 2
  for f in "$@"; do set -- "$@" "$plugin/hooks/$f.ts"; shift; done
  npx -y -p typescript tsc "$@" --target es2022 --module es2022 --skipLibCheck --ignoreConfig --outDir "$out/$mod"
  for ts in "$@"; do
    f=$(basename "$ts" .ts)
    # A browser-style import needs the file's extension.
    { echo "// Generated from $ts by scripts/build-herdr.sh. Do not edit."; sed -E "s#from '(\./[a-z]+)'#from '\1.js'#" "$out/$mod/$f.js"; } > "$plugin/herdr/$mod/$f.js"
  done
  { echo "// Generated from scripts/herdr/board.js by scripts/build-herdr.sh. Do not edit."; cat scripts/herdr/board.js; } > "$plugin/herdr/$mod/board.js"
}
build to-tickets tickets tickets
build wayfinder wayfinder tracker launch
rm -rf "$out"
