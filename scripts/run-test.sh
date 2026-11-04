#!/bin/sh
# Compile one test script with tsc and run it with `node --test`.
#
#   sh scripts/run-test.sh test-db
#   sh scripts/run-test.sh scripts/test-db.ts   (also accepted)
#
# Dependencies that the test imports are compiled along with it into
# .tmp-build/, mirroring the source tree, so "../lib/db" keeps resolving.
set -eu

name="${1:?usage: run-test.sh <name>  e.g. run-test.sh test-db}"

case "$name" in
  scripts/*) src="$name" ;;
  *.ts) src="scripts/$name" ;;
  *) src="scripts/$name.ts" ;;
esac

if [ ! -f "$src" ]; then
  echo "run-test.sh: no such script: $src" >&2
  exit 1
fi

base=$(basename "$src" .ts)

npx tsc "$src" \
  --module commonjs --target es2022 --moduleResolution node \
  --outDir .tmp-build --skipLibCheck --esModuleInterop \
  --lib es2022,dom --types node

node --test ".tmp-build/scripts/$base.js"
