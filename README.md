# obsidian-canvas-render

Render Obsidian `.canvas` files on the web, close to how Obsidian draws them — embedded notes, LaTeX, edges and all.

![screenshot](assets/screenshot.png)

**[Live demo](https://drmingdrmer.github.io/obsidian-canvas-render/)**

The file format is [JSON Canvas](https://jsoncanvas.org), the open spec Obsidian publishes under the MIT license. Obsidian's own renderer cannot be reused: it has no separate module, it is minified into `app.js` inside `obsidian.asar`, and it is wired to Obsidian's internal Vault, Workspace and MarkdownRenderer objects. So this is a fresh implementation against the spec — no build step, no npm dependencies, three source files a browser loads directly.

## Quick start

```bash
./serve.sh          # port 8000 by default; pass another as the first argument
```

A web server is required. The page fetches the `.canvas` file and the notes it embeds, and browsers block those requests under `file://`.

To view your own canvas, copy the canvas file and the notes it references into a directory, keeping the paths the canvas stores, then point the page at it:

```
?canvas=my-board/index.canvas
```

`sync-vault.sh` does that copying for you, reading the references straight out of the canvas:

```bash
./sync-vault.sh ~/Documents/my-vault my-board/index.canvas
```

It exits with an error if a referenced file is missing from the vault, so nothing gets silently dropped. Re-run it after adding nodes in Obsidian — the deployed copies do not update themselves.

## Deploying

Any static host works. There is nothing to build: upload the repository as-is and the site is live.

### GitHub Pages

Settings → Pages → Source → **Deploy from a branch** → `main` / `(root)`. The site appears at `https://<user>.github.io/<repo>/`.

**The `.nojekyll` file in the repository root is what makes this work.** Pages runs Jekyll on branch deploys, and Jekyll compiles `.md` files into `.html` instead of copying them through. Without `.nojekyll` every note would 404 and every file node on the canvas would fail to load.

### Other hosts

| Host | Why | Cost |
|---|---|---|
| **GitHub Pages** | The repository is already there; custom domains are free | Cannot set custom response headers |
| **Cloudflare Pages** | Free, fast CDN, supports a `_headers` file; leave the build command empty | One more service to wire up |
| **Netlify** | Same `_headers` support, and a folder can be drag-dropped in | 100 GB/month on the free tier |
| **Vercel** | Headers via `vercel.json` | Aimed at frameworks; a plain static site is a downgrade case |

Response headers do not actually matter here — see [Reading a note](#reading-a-note) — so pick on price and latency alone.

The repository is also served by jsDelivr without any setup, if you would rather not host the app yourself:

```
https://cdn.jsdelivr.net/gh/drmingdrmer/obsidian-canvas-render@main/canvas-render.js
```

## URL parameters

| Parameter | Required | Meaning |
|---|---|---|
| `canvas` | no | The `.canvas` file to render, relative to the page. Defaults to `vault/demo.canvas` |
| `vault` | no | The vault root that file nodes resolve against. Defaults to the directory holding the canvas file |
| `note` | no | Render a single markdown file on its own, for reading, instead of a canvas |
| `raw` | no | Show a single markdown file as plain source instead of rendering a canvas |

All four take same-origin relative paths only. A full URL with a scheme stops with an error rather than being fetched — this app is not a cross-site proxy.

### Why `vault` can be inferred

JSON Canvas file nodes store paths relative to the vault root. The least-effort deployment layout is one directory per canvas with the canvas file sitting at that directory's root, which makes the canvas's own directory the vault root. This repository's `vault/` is exactly such a bundle:

```
vault/
├── demo.canvas                        ← the canvas sits at the bundle root
└── pages/Mathematics-数学/…            ← the path a file node stores
```

so `?canvas=vault/demo.canvas` needs no second parameter. Serving several canvases means placing several such directories side by side:

```
?canvas=math/board.canvas         →  vault root = math/
?canvas=roadmap/2026.canvas       →  vault root = roadmap/
```

Only when the canvas lives in a subdirectory of the vault — common in Obsidian, where boards go in `boards/` and notes in `pages/` — does the root have to be named explicitly:

```
?canvas=notes/boards/plan.canvas&vault=notes/
```

Forgetting `vault` in that case looks like this: the canvas renders fine, but every file node's card reads `Cannot load … (HTTP 404)`, because the paths resolved against the canvas's subdirectory. That message is the cue to add the parameter.

## Supported

Nodes: `text`, `file`, `link`, `group`.
Edges: `fromSide` / `toSide` (both optional), the `fromEnd` / `toEnd` arrow switches, `label`, `color`.
Colors: Obsidian's six presets (`"1"`–`"6"`) and custom hex values.

Two things are not implemented:

- Block-reference subpaths `#^blockid` render the whole document
- `[[wikilinks]]` are styled but not navigable

## Interaction

Drag the background to pan; dragging inside a card's body selects text instead, and a card whose content overflows scrolls on its own. ⌘/Ctrl + wheel or a trackpad pinch zooms, a plain wheel pans. The controls at bottom left are zoom, fit, and the light/dark toggle, whose choice is kept in `localStorage`.

### Card titles

File and link cards carry a title row at the top, drawn **inside** the card, matching Obsidian's `.embed-title`: body font size, weight 600, one line with an ellipsis. A file node shows its name without the `.md` suffix, a link node shows its URL. Text nodes have no title row. A group's name sits **above** its frame — Obsidian's `.canvas-node-label`, and the only label drawn outside a card.

A file card's title row carries two links, both opening in a new tab so the canvas keeps its pan and zoom position: the title text opens the note rendered for reading, and the `</>` icon beside it opens the same file's markdown source. A link card carries only the title, pointing at its URL.

Each icon names its destination — an external-link mark on the title, `</>` on the source link, the usual sign for "show me the text behind this". The reading link keeps the title text as its target, since a word is an easier thing to hit than a 13px glyph.

The clickable area of each link is exactly its own content, not the whole row. The title row is a flex item and stretches to the card's width, but each `<a>` inside it is `inline-flex` and wraps only its text and icon. On a 460px card the title row measures 458px and the two links 82px and 13px; pressing the blank space to their right behaves like pressing anywhere else on the card — it pans the canvas.

### Reading a note

`?note=<path>` renders one markdown file on its own, through the same pipeline the cards use; `?raw=<path>` shows that file's source in a `<pre>`. Both views share a header giving the file's path, a link across to the other view, and the theme toggle.

Both fetch the file and decode it in the page, which is what frees them from the host's configuration. Hosts disagree on the media type they give markdown — GitHub Pages, nginx and Python's `http.server` all send it without a charset, and the browser then decodes UTF-8 bytes as Latin-1, turning `定义` into `å®šä¹‰`. `Response.text()` always decodes as UTF-8 whatever the response header claims, so the text comes out right wherever the files are served from.

`serve.sh` still overrides two media types for local use, so that opening a `.md` URL by hand also reads correctly:

```
.md      →  text/plain; charset=utf-8
.canvas  →  application/json; charset=utf-8
```

Nothing depends on it. Plain `python3 -m http.server` renders identically.

## How it works

### DOM and SVG, not a `<canvas>` element

"Canvas" here is Obsidian's whiteboard feature and has nothing to do with the HTML5 bitmap `<canvas>`. Node contents are rendered markdown that needs text selection, independent scrolling and KaTeX typesetting — capabilities that would all have to be rebuilt from scratch on a bitmap surface. So:

- every node is an absolutely positioned `div` whose `left/top/width/height` come straight from the node's `x/y/width/height`
- a card lays out as a flex column: the title row is `flex: none` at the top, the content area is `flex: 1`, takes the remaining height and scrolls on its own
- all edges are drawn in one `<svg>` layer stacked below the nodes
- `group` nodes take `z-index: 0` and sit at the very bottom

Obsidian is built the same way, which you can confirm by unpacking `obsidian.asar` and reading the class names in `app.css` — `canvas-node`, `canvas-node-container`, `canvas-edges`, `canvas-path-end`. This project reuses that naming.

### Pan and zoom

Nodes and edges share one container, `#canvas`, under a single transform:

```
transform: translate(view.x, view.y) scale(view.zoom)
```

Converting a screen coordinate to a canvas coordinate is that line inverted:

```
canvas coordinate = (screen coordinate - view.x) / view.zoom
```

Zooming anchored at the cursor (`zoomAt()`) works by recording the canvas coordinate under the cursor, changing `view.zoom`, then solving for the `view.x` / `view.y` that put the same canvas point back under the cursor. Measured drift is under 0.001 canvas pixels.

The dot grid stays outside that transform. It covers the viewport and follows along through `background-size`, which scales with `view.zoom`, and `background-position`, which is the pan offset modulo `GRID_SIZE * view.zoom`. Inside the transform it would run out of its own bounds when zoomed out.

### Edge shape

The S-curve of an Obsidian edge comes from where the control points go: both control points of the cubic Bézier are pushed out from their anchors **along the outward normal of the side they leave from**.

```
anchor        = midpoint of one side of a node
control point = anchor + outward normal × offset
offset        = max(EDGE_MIN_CONTROL_OFFSET, distance between anchors × EDGE_CONTROL_RATIO)
```

The arrowhead is a triangle with its tip on the node's border, pointing inwards. It is far wider than the stroke and covers the line's end outright, so the curve never has to be shortened — which saves solving for a point at a given parameter along it.

JSON Canvas allows `fromSide` / `toSide` to be omitted. When they are, `inferSide()` picks the sides facing the other node: left and right if the horizontal distance is at least the vertical one, top and bottom otherwise.

### Markdown pipeline

Source text cannot go straight to marked: inside math, `_`, `*` and `\` get read as subscripts, emphasis and escapes, and `\alpha` disappears. So one scan first separates four mutually exclusive kinds of fragment:

```js
/(```…```|`…`)|\$\$…\$\$|\$…\$|\[\[…\]\]/g
```

The alternation order is the precedence: fenced and inline code win, which keeps `` `$x$` `` literal exactly as Obsidian does, then display math, inline math and wikilinks.

The steps:

1. Math becomes a `CANVASMATH<n>ENDMATH` placeholder. Placeholders are letters and digits only, carry no markdown syntax, and marked leaves them alone
2. A `$$` block that occupies whole lines gets blank lines around its placeholder, making it a paragraph of its own. A `---` on the line right after the closing `$$` would otherwise read as a setext underline and turn the whole formula into a heading
3. Wikilinks become `<a>` tags directly — marked passes inline HTML through, so no placeholder is needed
4. marked parses the whole text
5. KaTeX output is substituted back by placeholder number. Display math that marked wrapped in its own `<p>` is unwrapped first, or the block-level `katex-display` would sit inside a paragraph

Leftovers from Wikipedia imports such as `[[ 1 ]](#cite_note-1)` render as a link followed by literal text. Obsidian produces the same thing; the problem is in the source document.

### Loading file node contents

A canvas stores vault-relative paths such as `pages/Mathematics-数学/形式导数.md`. The deployment directory keeps that path structure as-is, and the vault root worked out by the rule above is prefixed to it, so the canvas file itself never needs editing.

Paths contain spaces and non-ASCII characters. They are encoded by splitting on `/` and running `encodeURIComponent` per segment. `encodeURI` over the whole string would leave a `#` in a file name unencoded, and the URL would be cut short there.

Dispatch is by extension: `.md` goes through the markdown pipeline, image extensions become an `<img>`, anything else an `<iframe>`. A node with a `subpath` such as `#Some heading` gets that section sliced out by heading level before rendering.

## Tunable constants

All at the top of `canvas-render.js`:

| Constant | Default | Effect |
|---|---|---|
| `EDGE_CONTROL_RATIO` | 0.35 | How much edges bow; raise it for rounder curves |
| `ZOOM_WHEEL_SENSITIVITY` | 400 | Wheel zoom sensitivity; raise it to slow zooming down. One mouse notch (deltaY 120) is 1.35× |
| `GRID_SIZE` | 20 | Dot spacing, same as Obsidian |
| `MIN_ZOOM` / `MAX_ZOOM` | 0.1 / 3 | Zoom range |
| `FIT_MAX_ZOOM` | 1 | Upper bound when fitting, so sparse canvases are not blown up |
| `DEFAULT_CANVAS_PATH` | `vault/demo.canvas` | Loaded when no `?canvas=` is given |

## Repository layout

```
index.html          page skeleton
canvas-render.js    the renderer
canvas-render.css   Obsidian-like styling, light and dark
lib/                marked and KaTeX
serve.sh            local web server
sync-vault.sh       re-copy the files a canvas references
assets/             README images
vault/              sample bundle: a canvas plus the notes it embeds
├── demo.canvas
└── pages/Mathematics-数学/…
```

Everything above `vault/` is the application; `vault/` is content. Deploying means uploading the application once, then adding one more directory of the same shape per canvas.

## Third-party components

The application code is licensed under [Apache-2.0](LICENSE). Bundled and redistributed under their own terms:

| Component | Version | Used for | License |
|---|---|---|---|
| [marked](https://github.com/markedjs/marked) | 12.0.2 | Markdown parsing, with GFM on for tables and strikethrough | [MIT](lib/LICENSE-marked) |
| [KaTeX](https://katex.org) | 0.16.11 | LaTeX typesetting | [MIT](lib/LICENSE-katex) |

Both are vendored under `lib/` rather than loaded from a CDN, so the page works offline — a vault is local, and needing the network to render it would be odd.

Only the 20 woff2 fonts the KaTeX stylesheet actually references are kept (296 KB). The matching woff and ttf fallbacks are not included: they come after woff2 in each `@font-face` `src` list, and a current browser stops at the first format it supports.

The sample notes under `vault/pages/` are adapted from Wikipedia and remain licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), separately from the Apache-2.0 application code. Each note names its source article at the bottom.

## References

- [JSON Canvas specification](https://github.com/obsidianmd/jsoncanvas)
- [Obsidian's JSON Canvas announcement](https://obsidian.md/blog/json-canvas/)
