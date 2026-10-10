# Using obsidian-canvas-render

## Serving a canvas

The page fetches its content at runtime, so it has to be served over HTTP:

```bash
./serve.sh          # port 8000 by default; pass another as the first argument
```

Point it at a canvas with `?canvas=my-board/index.canvas`. That canvas file and the notes it references must sit under the served directory, keeping the paths the canvas stores. `sync-vault.sh` copies them out of an Obsidian vault for you, and fails if one of them is missing there:

```bash
./sync-vault.sh ~/Documents/my-vault my-board/index.canvas
```

Everything outside `vault/` is the application; `vault/` is one content bundle, and serving a second canvas means adding a second directory of the same shape.

## Deploying

Any static host serves the repository as-is. On GitHub Pages, **keep the `.nojekyll` file in the repository root**: Jekyll compiles `.md` files into `.html` instead of copying them through, so without it every note 404s and every file node on the canvas fails to load.

## URL parameters

| Parameter | Meaning |
|---|---|
| `canvas` | The `.canvas` file to render, relative to the page. Defaults to `vault/demo.canvas` |
| `vault` | The vault root that file nodes resolve against. Defaults to the directory holding the canvas file |
| `note` | Render a single markdown file on its own, for reading, instead of a canvas |
| `raw` | Show a single markdown file as plain source |
| `cards` | Draw every card at one size — `actual`, `wide` or `compact` — instead of the size each card stores |

`canvas`, `vault`, `note` and `raw` each take a path relative to the page, or an `https://` URL on one of the hosts in `REMOTE_HOSTS` at the top of `canvas-render.js` — `raw.githubusercontent.com` by default. Every other host is refused: a note is rendered with `innerHTML`, so whichever host serves one can run script in this page's origin.

File nodes store paths relative to the vault root, so a canvas sitting at the root of its own directory needs no `vault` — that is how `?canvas=vault/demo.canvas` works. Name the root explicitly when the canvas sits deeper in the vault, as it does in Obsidian when boards go in `boards/` and notes in `pages/`:

```
?canvas=notes/boards/plan.canvas&vault=notes/
```

Omitting it then renders the canvas with every file card reading `Cannot load … (HTTP 404)`.

### A canvas on another host

A canvas and the notes it embeds can stay in a GitHub repository, with nothing copied under the served directory:

```
?canvas=https://raw.githubusercontent.com/user/repo/refs/heads/main/boards/plan.canvas
```

The vault root still defaults to the directory holding the canvas, so notes stored beside it need no `vault`; notes elsewhere in the repository need the root named, `vault=https://raw.githubusercontent.com/user/repo/refs/heads/main/`.

The host has to send `Access-Control-Allow-Origin`, which `raw.githubusercontent.com` does. Without that header the browser blocks the fetch before any status code exists, and the page reports the block instead of an HTTP error.

## Moving around the board

Dragging the background pans. ⌘/Ctrl + wheel, or a trackpad pinch, zooms. A plain wheel moves the board, and keeps moving it wherever the pointer happens to be — a card that slides under a still pointer partway through cannot take the rest of the gesture over.

Pressing a card puts the focus on it, marked by an accent border. A wheel over that one card then scrolls its content, which is how a card longer than its box is read. Pressing the board takes the focus back, and the wheel moves the board again.

## Moving and resizing cards

A card moves by its title row alone, and its edges follow; every other part of it is left to select, scroll and click. A text card is moved by the header strip its first line becomes; a text card without one — its content reaches the border — stays where the file puts it. Pressing a group's frame moves the group together with every card the frame encloses, fixed at the moment the drag starts.

A card is resized by the grip in its bottom-right corner, which shows while the pointer is on that card and stops at 120 × 60.

Nothing is written back to the file: a reload restores the board the `.canvas` describes.

## Controls

The bar in the corner holds three groups: the zoom, the size of every card, and the theme.

`Actual`, `Wide` and `Compact` set the size of every card at once. `Actual` gives each card the size its file stores, `Wide` draws them all 520 px across and `Compact` 320 px. At both fixed widths the content sets the height, capped at 480 px and 240 px, so a long note scrolls inside its card rather than towering over the board. A card holding an image is as tall as the image needs, and one holding an iframe takes the cap, an iframe having no height of its own. Group frames keep the size the file gives them, since a frame marks out a region of the board.

Every card keeps its stored position through all of this, so a card that grows can overlap its neighbour until it is dragged aside. Resizing a single card by its grip takes that card out of the uniform size; pressing the same size button again puts the whole board back under it.

`Grid` lands a dragged card on the 20 px grid the background dots mark out, so cards line up with each other without being nudged into place. The card under the pointer is the one that aligns, and a group's frame carries its contents along at their own offsets. A resize grip aligns the corner it drags, which is the edge that has to meet the neighbours — a card's own origin may sit off the grid.

The card size, the grid and the theme are all remembered across visits. Until the theme toggle is pressed, the theme follows the system's light or dark setting.

## Reading a note on its own

A note card's title row carries two links: the title text opens the note rendered for reading (`?note=`), and the `</>` icon beside it opens the same file's markdown source (`?raw=`). The title of any other file card, such as an image or a PDF, opens the file itself, and a link card's title points at its URL.
