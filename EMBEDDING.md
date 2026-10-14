# Showing a canvas board in a blog post

A static blog shows an Obsidian canvas board inside a post by calling `mount` from `canvas-render.js` in the post. The site serves the renderer, and the board's files, from a folder that its generator copies unchanged. For `drmingdrmer.github.io`, which is a Jekyll blog, [Example: a board on drmingdrmer.github.io](#example-a-board-on-drmingdrmergithubio) gives the exact commands.

`mount` draws the board inside an element of the post, in a shadow root, so the post's styles and the board's stay apart. The board's files must sit on the post's own site, or on `raw.githubusercontent.com`, the one host in `REMOTE_HOSTS` at the top of `canvas-render.js`.

## Step 1: find the folder the site serves unchanged

The renderer fetches each note as a `.md` file, so the site must serve the notes exactly as they are. Each generator copies one folder that way:

| Generator | Folder served unchanged |
|---|---|
| Hugo | `static/` |
| Hexo | the paths under `source/` that `skip_render` in `_config.yml` matches, such as `boards/**` |
| Astro, Vite | `public/` |

The commands below use Hugo's `~/blog/static/` for that folder.

Jekyll turns each `.md` file that starts with front matter into an `.html` page, and does not publish the `.md` file itself. Obsidian writes a note's properties as front matter, so in a Jekyll site each note with properties answers 404. GitHub Pages runs Jekyll on a site deployed from a branch, unless the branch's root holds an empty `.nojekyll` file. A Jekyll blog cannot hold that file without stopping its own build. So a Jekyll blog on GitHub Pages keeps its boards in another repository, one that holds `.nojekyll`. GitHub Pages serves each repository's site under the account's address, `https://<user>.github.io/<repository>/`, so every repository of the account, the blog included, counts as one site.

## Step 2: copy the renderer into that folder

Copy these four items from this repository into a folder named `canvas/`:

```
~/blog/static/canvas/
├── index.html
├── canvas-render.js
├── canvas-render.css
└── lib/
```

The site then serves the renderer at `/canvas/`. A post needs `canvas-render.js`, `canvas-render.css` and `lib/`. A note link on the board opens `index.html`.

## Step 3: fill a board folder with sync-vault.sh

Copy the board's `.canvas` file into an empty folder, then run `sync-vault.sh` from this repository. The script reads that copy, and copies out of the vault each note the board names and each image those notes embed:

```bash
mkdir -p ~/blog/static/boards/raft
cp ~/vault/raft.canvas ~/blog/static/boards/raft/
~/obsidian-canvas-render/sync-vault.sh ~/vault ~/blog/static/boards/raft/raft.canvas assets
```

- Give the script absolute paths. It changes into its own folder before it reads them.
- The folder that holds the `.canvas` file serves as the vault root. Each note lands under it, at the path the canvas stores for the note, and the renderer looks for the note there.
- The third argument, `assets`, is the vault's attachment folder, which Obsidian sets under Settings → Files and links → Default location for new attachments. The script needs it when a note embeds an image by file name alone, such as `![](fig.png)`.
- After you edit the board in Obsidian, run the `cp` and the script again. The script reads the copy of the `.canvas` file, so the copy must be fresh.

Once the site is built, open one note's address, such as `https://<site>/boards/raft/leader.md`. The browser must show the raw markdown. A 404 means the generator changed or dropped the note, and the note's card on the board then reads `Cannot read … (HTTP 404)`.

## Step 4: mount the board in a post

Put the board's element, the script that mounts it, and a link to the full page into the post:

```html
<div id="raft-board" style="height:70vh;border:1px solid #ccc"></div>
<script type="module">
  import { mount } from '/canvas/canvas-render.js'

  mount(document.getElementById('raft-board'), { canvas: '/boards/raft/raft.canvas', attachments: 'assets' })
</script>
<a href="/canvas/?canvas=/boards/raft/raft.canvas&attachments=assets" target="_blank">Open the board in its own tab</a>
```

- `canvas: '/boards/raft/raft.canvas'` starts with `/`, so it names the same file from any post. A path without the leading `/` is relative to the post's address.
- `attachments: 'assets'` names the same folder as the third argument of `sync-vault.sh`. Leave it out when you left that argument out.
- A post shows one board. A second `mount` on the same page fails.
- Over the board, the mouse wheel and a two-finger trackpad swipe scroll the post, as they do anywhere else on it. Ctrl or ⌘ with the wheel, or a pinch, zooms the board, and a drag on its background pans it. The wheel scrolls a card only after a click on the card.
- Hugo drops raw HTML from Markdown unless the site config sets `markup.goldmark.renderer.unsafe = true`. Jekyll and Hexo keep it.

## Step 5: copy the opening view from the renderer's address

The renderer's own page keeps its view in its address. Open the board in its own tab, move it to the view the post needs, and copy the address. The address now ends in `at=<x>,<y>,<zoom>`. After a search or a wikilink fits the view to one card, it ends in `focus=<card id>` instead. Add that parameter to the second argument of `mount`, such as `{ canvas: '/boards/raft/raft.canvas', at: '120,40,0.8' }`. Adding `cards: 'compact'` draws every card at one compact size, which suits a narrow post.

## Example: a board on drmingdrmer.github.io

GitHub Pages builds `https://drmingdrmer.github.io/` with Jekyll, from the repository `drmingdrmer/drmingdrmer.github.io`. So, as Step 1 explains, the boards go into another repository:

- This repository already serves the renderer at `https://drmingdrmer.github.io/obsidian-canvas-render/`, so Step 2 is done.
- A new repository, `drmingdrmer/canvas-boards`, holds the boards. GitHub Pages serves it at `https://drmingdrmer.github.io/canvas-boards/`, on the same site as the renderer and the blog.

1. Create the repository with an empty `.nojekyll`, and fill one board folder. Replace `~/path/to/vault` with the vault's path:

   ```bash
   mkdir ~/xp/vcs/github.com/drmingdrmer/canvas-boards
   cd ~/xp/vcs/github.com/drmingdrmer/canvas-boards
   git init -b main
   touch .nojekyll
   mkdir apaxos
   cp ~/path/to/vault/abstract-paxos.canvas apaxos/
   ~/xp/vcs/github.com/drmingdrmer/obsidian-canvas-render/sync-vault.sh ~/path/to/vault "$PWD/apaxos/abstract-paxos.canvas" assets
   ```

2. Publish the repository, and turn on GitHub Pages for its `main` branch:

   ```bash
   git add . && git commit -m 'add the apaxos board'
   gh repo create drmingdrmer/canvas-boards --public --source . --push
   gh api -X POST repos/drmingdrmer/canvas-boards/pages -f 'source[branch]=main' -f 'source[path]=/'
   ```

3. When the Pages build has finished, open `https://drmingdrmer.github.io/canvas-boards/apaxos/def-Time.md`. It must show the raw note.

4. Put the board into a post under `_posts/`:

   ```html
   <div id="apaxos-board" style="height:70vh;border:1px solid #ccc"></div>
   <script type="module">
     import { mount } from '/obsidian-canvas-render/canvas-render.js'

     mount(document.getElementById('apaxos-board'), { canvas: '/canvas-boards/apaxos/abstract-paxos.canvas', attachments: 'assets' })
   </script>
   ```

After you edit the board, run the `cp` and `sync-vault.sh` lines of step 1 again, then commit and push.

The renderer is served from the `main` branch of `obsidian-canvas-render`, so each change pushed there reaches every embedded board at once.

## Reading a board from raw.githubusercontent.com

The renderer can also read a board straight out of a public GitHub repository, through `raw.githubusercontent.com`. That host sends `Access-Control-Allow-Origin: *`, which lets a page on any site read its files. The site then serves only the renderer, and never handles a `.md` file:

```js
mount(document.getElementById('raft-board'), {
  canvas: 'https://raw.githubusercontent.com/<user>/<repository>/refs/heads/main/boards/raft/raft.canvas',
  attachments: 'assets',
})
```

This way has two limits:

- A file card for a PDF, or for any other file that is neither a note nor an image, shows the browser's refusal instead of the file. The renderer shows such a file in a frame, and `raw.githubusercontent.com` forbids framing with `X-Frame-Options: deny`.
- GitHub limits how many files a signed-out reader may download from `raw.githubusercontent.com`, and does not publish the number ([changelog, 2025-05-08](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)). The board downloads one file per note card, so on a large board some cards may read `Cannot read … (HTTP 429)`.
