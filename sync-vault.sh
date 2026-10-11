#!/bin/bash
# Copy every file a canvas references, and every image its notes embed, out of
# a real Obsidian vault into the canvas file's own directory — the directory the
# page treats as the vault root.
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
import re
import shutil
import sys
from urllib.parse import unquote

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


# An image a note embeds: `![alt](path "title")`, `![alt](<path>)` or
# `<img src="path">`.
IMAGE_REFERENCE = re.compile(
    r'!\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))|<img\b[^>]*?\bsrc\s*=\s*["\']?([^"\'\s>]+)',
    re.IGNORECASE,
)

# A URL with a scheme or a host, a path from the server root, or a fragment.
NOT_A_VAULT_PATH = re.compile(r'^(?:[a-z][a-z0-9+.-]*:|/|#)', re.IGNORECASE)


def embedded_images(note_path, source):
    """The vault paths of the images a note embeds, each resolved against the note's directory, as the page does."""
    with open(source, encoding='utf-8') as handle:
        text = handle.read()

    for match in IMAGE_REFERENCE.finditer(text):
        references = [group for group in match.groups() if group]
        if not references or NOT_A_VAULT_PATH.match(references[0]):
            continue

        path = unquote(references[0].split('#')[0].split('?')[0])
        yield os.path.normpath(os.path.join(os.path.dirname(note_path), path))


# Every path is checked before any file is copied, so a bad one leaves the
# bundle as it was. A file named twice is copied once.
copies = {}
for node in canvas.get('nodes', []):
    if node.get('type') != 'file':
        continue

    relative_path = node['file']
    source = inside(source_root, relative_path)
    if not os.path.isfile(source):
        raise SystemExit(f'not found in vault: {source}')

    target = inside(bundle_root, relative_path)
    copies[relative_path] = (source, target)
    if not relative_path.lower().endswith('.md'):
        continue

    # Obsidian also finds an image by its file name alone, which a browser
    # cannot: such an image is left out, as one that does not exist.
    for image_path in embedded_images(relative_path, source):
        image_source = inside(source_root, image_path)
        if not os.path.isfile(image_source):
            print(f'skipped {image_path}, embedded in {relative_path}: not found in vault', file=sys.stderr)
            continue

        image_target = inside(bundle_root, image_path)
        copies[image_path] = (image_source, image_target)

for relative_path, (source, target) in copies.items():
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.copy2(source, target)
    print(relative_path)
PYTHON
