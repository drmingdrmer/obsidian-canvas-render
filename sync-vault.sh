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

source_root = os.path.realpath(source_vault)
bundle_root = os.path.realpath(os.path.dirname(canvas_file) or '.')


def inside(root, relative_path):
    """root joined with relative_path, refused unless it stays in root once symlinks are followed."""
    if os.path.isabs(relative_path):
        raise SystemExit(f'not a relative path: {relative_path}')

    path = os.path.realpath(os.path.join(root, relative_path))
    if os.path.commonpath([root, path]) != root:
        raise SystemExit(f'outside {root}: {relative_path}')
    return path


# Every path is checked before any file is copied, so a bad one leaves the
# bundle as it was.
copies = []
for node in canvas.get('nodes', []):
    if node.get('type') != 'file':
        continue

    relative_path = node['file']
    source = inside(source_root, relative_path)
    if not os.path.isfile(source):
        raise SystemExit(f'not found in vault: {source}')

    target = inside(bundle_root, relative_path)
    copies.append((relative_path, source, target))

for relative_path, source, target in copies:
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.copy2(source, target)
    print(relative_path)
PYTHON
