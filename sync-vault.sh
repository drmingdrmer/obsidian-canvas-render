#!/bin/bash
# Copy every file a canvas references out of a real Obsidian vault into the
# canvas file's own directory — the directory the page treats as the vault root.
# Re-run after editing the canvas in Obsidian.
#
#   ./sync-vault.sh <source-vault> [canvas-file]
#
# Example:
#   ./sync-vault.sh ~/Documents/my-vault vault/demo.canvas
set -e
cd "$(dirname "$0")"

if [ $# -lt 1 ]; then
    echo "usage: $(basename "$0") <source-vault> [canvas-file]" >&2
    echo "  source-vault  root of the Obsidian vault to copy notes out of" >&2
    echo "  canvas-file   canvas to read references from (default: vault/demo.canvas)" >&2
    exit 2
fi

SOURCE_VAULT="$1"
CANVAS_FILE="${2:-vault/demo.canvas}"

python3 - "$SOURCE_VAULT" "$CANVAS_FILE" <<'PYTHON'
import json
import os
import shutil
import sys

source_vault, canvas_file = sys.argv[1], sys.argv[2]

with open(canvas_file, encoding='utf-8') as handle:
    canvas = json.load(handle)

bundle_root = os.path.dirname(canvas_file) or '.'

for node in canvas.get('nodes', []):
    if node.get('type') != 'file':
        continue

    relative_path = node['file']
    source = os.path.join(source_vault, relative_path)
    if not os.path.exists(source):
        raise SystemExit(f'not found in vault: {source}')

    target = os.path.join(bundle_root, relative_path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.copy2(source, target)
    print(relative_path)
PYTHON
