#!/bin/bash
# Serve this directory so the page can fetch the .canvas file and the notes it
# embeds. Markdown is served as UTF-8 plain text so that clicking a card's title
# opens the source readably; the stock text/markdown type carries no charset and
# browsers then decode Chinese as Latin-1.
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

port = int(sys.argv[1])
print(f'http://localhost:{port}/')
http.server.test(HandlerClass=Handler, port=port, bind='127.0.0.1')
PYTHON
