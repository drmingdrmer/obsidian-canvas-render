#!/bin/bash
# Copy every file a canvas references, and every image its notes embed, out of
# a real Obsidian vault into the canvas file's own directory — the directory the
# page treats as the vault root.
# Re-run after editing the canvas in Obsidian.
#
#   ./sync-vault.sh <source-vault> [canvas-file] [attachments]
#
# Example:
#   ./sync-vault.sh ~/Documents/my-vault vault/demo.canvas
set -e
cd "$(dirname "$0")"

if [ $# -lt 1 ]; then
    echo "usage: $(basename "$0") <source-vault> [canvas-file] [attachments]" >&2
    echo "  source-vault  root of the Obsidian vault to copy notes out of" >&2
    echo "  canvas-file   canvas to read references from (default: vault/demo.canvas)" >&2
    echo "  attachments   folder in the vault where Obsidian puts new attachments; an" >&2
    echo "                image named by its file name alone is looked for there first" >&2
    exit 2
fi

SOURCE_VAULT="$1"
CANVAS_FILE="${2:-vault/demo.canvas}"

python3 - "$SOURCE_VAULT" "$CANVAS_FILE" "${@:3}" <<'PYTHON'
import json
import os
import re
import shutil
import sys
from urllib.parse import unquote

source_vault, canvas_file = sys.argv[1], sys.argv[2]
# The folder, under the vault root, where Obsidian puts new attachments; None
# when no third argument names one.
attachments = sys.argv[3] if len(sys.argv) > 3 else None

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


def embedded_images(note_path, source, attachments):
    """For each image a note embeds, the vault paths the page tries for it, in order.

    Every path is resolved against the note's directory. A file name alone is
    tried in the attachment folder first, when there is one.
    """
    with open(source, encoding='utf-8') as handle:
        text = handle.read()

    for match in IMAGE_REFERENCE.finditer(text):
        references = [group for group in match.groups() if group]
        if not references or NOT_A_VAULT_PATH.match(references[0]):
            continue

        path = unquote(references[0].split('#')[0].split('?')[0])
        beside_note = os.path.normpath(os.path.join(os.path.dirname(note_path), path))
        is_name_alone = '/' not in references[0]
        if attachments is None or not is_name_alone:
            yield [beside_note]
            continue

        yield [os.path.normpath(os.path.join(attachments, path)), beside_note]


if attachments is not None and not os.path.isdir(inside(source_root, attachments)):
    raise SystemExit(f'not a folder in vault: {attachments}')

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

    # Obsidian finds an image by its file name alone wherever it sits, which a
    # browser cannot: one at none of the paths the page tries is left out.
    for image_paths in embedded_images(relative_path, source, attachments):
        found = [path for path in image_paths if os.path.isfile(inside(source_root, path))]
        if not found:
            tried = ' or '.join(image_paths)
            print(f'skipped {tried}, embedded in {relative_path}: not found in vault', file=sys.stderr)
            continue

        image_path = found[0]
        image_source = inside(source_root, image_path)
        image_target = inside(bundle_root, image_path)
        copies[image_path] = (image_source, image_target)

for relative_path, (source, target) in copies.items():
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.copy2(source, target)
    print(relative_path)
PYTHON
