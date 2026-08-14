#!/bin/bash
# Serve this directory so the page can fetch the .canvas file and the notes it
# embeds.
#
# Markdown is served as UTF-8 plain text purely as a convenience, for when a .md
# URL is opened by hand: the stock text/markdown type carries no charset and
# browsers then decode UTF-8 as Latin-1. The app itself does not depend on this —
# it reads note sources through its own ?raw= view, which always decodes UTF-8.
set -e
cd "$(dirname "$0")"

PORT="${1:-8000}"

python3 - "$PORT" <<'PYTHON'
import http.server
import sys

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.md': 'text/plain; charset=utf-8',
        '.canvas': 'application/json; charset=utf-8',
    }

    def end_headers(self):
        # Nothing is cached while developing. A page that mixes a fresh
        # index.html with a cached canvas-render.js fails on whichever element
        # one of them no longer knows about, and reads as a code bug.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1])
print(f'http://localhost:{port}/')
http.server.test(HandlerClass=Handler, port=port, bind='127.0.0.1')
PYTHON
