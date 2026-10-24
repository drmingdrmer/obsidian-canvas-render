# Using obsidian-canvas-render

## Serving a canvas

The page fetches its content at runtime, so it has to be served over HTTP:

```bash
./serve.sh          # port 8000 by default; pass another as the first argument
```

Point it at a canvas with `?canvas=my-board/index.canvas`. That canvas file and the notes it references must sit under the served directory, keeping the paths the canvas stores. `sync-vault.sh` copies them out of an Obsidian vault for you, along with the images those notes embed. It copies nothing if one of them is missing there, or if a path leads outside the vault or the canvas directory. An embedded image it cannot find is left out, with a warning:

```bash
./sync-vault.sh ~/Documents/my-vault my-board/index.canvas
```

An image or a link in a note is found relative to the note's own directory, as Obsidian's "Relative path to file" link format writes it. Obsidian also finds an image by its file name alone, wherever it sits in the vault. A browser cannot list the files in a folder on a web server, so the page looks for such an image in the folder the `attachments` parameter names, and then beside the note. An image it cannot load shows `Cannot load image <path>` where it would have been. `sync-vault.sh` takes the same folder as a third argument, and copies such an image from that folder, or else from beside the note:

```bash
./sync-vault.sh ~/Documents/my-vault my-board/index.canvas assets
```

Everything outside `vault/` is the application; `vault/` is one content bundle, and serving a second canvas means adding a second directory of the same shape.

## Deploying

Any static host serves the repository as-is. On GitHub Pages, **keep the `.nojekyll` file in the repository root**: Jekyll compiles `.md` files into `.html` instead of copying them through, so without it every note 404s and every file node on the canvas fails to load.

## URL parameters

| Parameter | Meaning |
|---|---|
| `canvas` | The `.canvas` file to render, relative to the page. Defaults to `vault/demo.canvas` |
| `vault` | The vault root that file nodes resolve against. Defaults to the directory holding the canvas file |
| `attachments` | The folder, under the vault root, where Obsidian puts new attachments. An image a note names by its file name alone is looked up there first |
| `note` | Render a single markdown file on its own, for reading, instead of a canvas |
| `raw` | Show a single markdown file as plain source |
| `cards` | Draw every card at one size — `actual`, `wide` or `compact` — instead of the size each card stores |
| `at` | Open the board on `<x>,<y>,<zoom>`: that canvas point at the centre of the window, at that zoom, where 1 is 100% |
| `focus` | Open the board fitted to the card with this id, with the focus on it |
| `text` | Draw the text on the board this many times its own size, from 0.25 to 4, in cards of the same size. Defaults to 1 |

`canvas`, `vault`, `note` and `raw` each take a path relative to the page, or an `https://` URL on one of the hosts in `REMOTE_HOSTS` at the top of `canvas-render.js` — `raw.githubusercontent.com` by default. Every other host is refused: a note is stripped of script before it is drawn, but the rest of it still appears as this page's own content. The same rule holds for the file each file card names, and for `attachments`, once the vault root is put in front of them. A card whose file leads to any other host shows the refusal instead.

File nodes store paths relative to the vault root, so a canvas sitting at the root of its own directory needs no `vault` — that is how `?canvas=vault/demo.canvas` works. Name the root explicitly when the canvas sits deeper in the vault, as it does in Obsidian when boards go in `boards/` and notes in `pages/`:

```
?canvas=notes/boards/plan.canvas&vault=notes/
```

Omitting it then renders the canvas with every file card reading `Cannot read … (HTTP 404)`.

### A canvas on another host

A canvas and the notes it embeds can stay in a GitHub repository, with nothing copied under the served directory:

```
?canvas=https://raw.githubusercontent.com/user/repo/refs/heads/main/boards/plan.canvas
```

The vault root still defaults to the directory holding the canvas, so notes stored beside it need no `vault`; notes elsewhere in the repository need the root named, `vault=https://raw.githubusercontent.com/user/repo/refs/heads/main/`.

The host has to send `Access-Control-Allow-Origin`, which `raw.githubusercontent.com` does. Without that header the browser blocks the fetch before any status code exists, and the page reports the block instead of an HTTP error.

## Showing a board inside another page

`canvas-render.js` is an ES module. Its `mount` draws a board inside an element of any page:

```html
<div id="board" style="height: 70vh"></div>
<script type="module">
  import { mount } from '/obsidian-canvas-render/canvas-render.js'

  mount(document.getElementById('board'), { canvas: 'boards/plan.canvas', attachments: 'assets' })
</script>
```

- The second argument takes the URL parameters above, by the same names. A relative path in it is relative to the page's address.
- The board is drawn in a shadow root, so the page's styles do not reach the board, and the board's styles do not reach the page. The page sets the element's height; without one, the board is 70% as tall as the window.
- A plain wheel over the board scrolls the page. Ctrl or ⌘ with the wheel, or a trackpad pinch, zooms the board, and a drag on its background pans it. Alt with the wheel or the pinch changes its text size. The wheel scrolls a card only after a press on the card puts the focus on it.
- The board never writes `at`, `focus` or `text` into the page's address. To open it on a view, copy those from the renderer's own page, and add them to the second argument.
- A click on a note card's title, on its `</>` icon, or on a wikilink to a note without a card shows the note inside the board, over the cards. The ← button above the note goes back to the cards. With ⌘, Ctrl or Shift held, the click opens the renderer's own page, `index.html` beside `canvas-render.js`. That page reads the note only when the renderer sits on the page's own site.
- `mount` loads `marked`, KaTeX and DOMPurify from `lib/` beside the module. A page that has loaded one of them already lends its copy to the board.
- `mount` also adds KaTeX's stylesheet to the page's `<head>`, because a browser loads fonts only from the page's own stylesheets. That stylesheet styles any KaTeX formula of the page too.
- A page shows one board. A second `mount` fails.

`index.html` calls `mount(document.body)`. Without the second argument, the board reads the URL parameters from the page's address, and keeps its view there.

## Moving around the board

Dragging the background pans. ⌘/Ctrl + wheel, or a trackpad pinch, zooms. A plain wheel moves the board, and keeps moving it wherever the pointer happens to be — a card that slides under a still pointer partway through cannot take the rest of the gesture over.

Alt + wheel, or Alt with a trackpad pinch, makes the text on the board larger or smaller, between 0.25× and 4×. The cards, the edges and the images keep their place and their size. Text at 0.5× takes a quarter of the room, so a card shows about four times as much of its note without being opened. A card that `Wide` or `Compact` sizes by its content grows or shrinks with its text.

Pressing a card puts the focus on it, marked by an accent border. A wheel over that one card then scrolls its content, which is how a card longer than its box is read. Pressing the board takes the focus back, and the wheel moves the board again.

Holding Space shows the focused card whole, over the board, until Space is let go. The card is drawn at 100%, or at the board's zoom when that is larger. It grows right and down from its top-left corner, up to the edges of the board: at least 520 px wide, and as tall as its content. A longer card scrolls inside. Near the right or bottom edge of the board, the card moves left or up, only as far as it takes to be as large as the same card in Wide: 520 px wide, and up to 480 px tall. Its box on the board, its edges and the other cards stay where they are. The button in the focused card's top-right corner does the same on a touch screen. It keeps the card enlarged until it is pressed again or the focus leaves the card. The button stays where it was while the card is enlarged, so a second press in the same place puts the card back.

The address bar follows the view, so a copied link opens the board on the same view. A view fitted to one card, by a search or a wikilink, is written as `focus=<card id>`. Any other moved view is written as `at=<x>,<y>,<zoom>`, with the canvas point at the centre of the window, so the link shows the same spot in a window of any size. A view fitted to the whole board writes neither. A text size other than 1× is written as `text=<n>` as well. A link to a card the board no longer holds says so, and shows the whole board.

## Moving and resizing cards

A card moves by its title row alone, and its edges follow; every other part of it is left to select, scroll and click. A text card is moved by the header strip its first line becomes; a text card without one — its content reaches the border — stays where the file puts it. Pressing a group's frame moves the group together with every card the frame encloses, fixed at the moment the drag starts.

A card is resized by the grip in its bottom-right corner, which shows while the pointer is on that card and stops at 120 × 60.

Nothing is written back to the file: a reload restores the board the `.canvas` describes.

## Controls

The bar in the corner holds the search box, the zoom, the text size, the size of every card, the grid and the theme.

The search box lists the cards whose name or text holds what is typed, ignoring case: a note card's file name and its note, a text card's text, a link card's URL and a group's label. Cards whose name holds it come first. Picking one, or pressing Enter for the first, fits the view to that card, at 100% at most, and puts the focus on it. Escape clears the box. The view stays on that card while the window or the card changes size, until the board is moved by hand.

The text size's `−` and `+` make the text about 10% smaller or larger, and seven presses halve or double it. The label between them shows the text size, and resets it to 1×.

`Actual`, `Wide` and `Compact` set the size of every card at once. `Actual` gives each card the size its file stores, `Wide` draws them all 520 px across and `Compact` 320 px. At both fixed widths the content sets the height, capped at 480 px and 240 px, so a long note scrolls inside its card rather than towering over the board. A card holding an image is as tall as the image needs, and one holding an iframe takes the cap, an iframe having no height of its own. Group frames keep the size the file gives them, since a frame marks out a region of the board.

Every card keeps its stored position through all of this, so a card that grows can overlap its neighbour until it is dragged aside. Resizing a single card by its grip takes that card out of the uniform size; pressing the same size button again puts the whole board back under it.

`Grid` lands a dragged card on the 20 px grid the background dots mark out, so cards line up with each other without being nudged into place. The card under the pointer is the one that aligns, and a group's frame carries its contents along at their own offsets. A resize grip aligns the corner it drags, which is the edge that has to meet the neighbours — a card's own origin may sit off the grid.

The card size, the grid and the theme are all remembered across visits. Until the theme toggle is pressed, the theme follows the system's light or dark setting.

## Reading a note on its own

A note card's title row carries two links: the title text opens the note rendered for reading (`?note=`), and the `</>` icon beside it opens the same file's markdown source (`?raw=`). The title of any other file card, such as an image or a PDF, opens the file itself, and a link card's title points at its URL. When the board names an attachment folder, both note links carry it, along with the vault root, so that the note finds its images where the board does.

A `[[wikilink]]` leads to the note it names. When the board has a card for that note, the link fits the view to the card and puts the focus on it; the card is found by a path its file ends in, ignoring case, as Obsidian finds a note by its name alone. Otherwise the link opens the note on its own, looked for beside the note or canvas the link is written in, since a browser cannot search the vault for it. `[[Note#Heading]]` opens the whole note.
