# Showing a canvas board in a blog post

A static blog shows an Obsidian canvas board inside a post by calling `mount` from `canvas-render.js` in the post. The post loads `canvas-render.js` from this repository's GitHub Pages site. The blog serves only the board's files, from a folder that its generator copies unchanged. For `drmingdrmer.github.io`, which is a Jekyll blog, [Example: a board on drmingdrmer.github.io](#example-a-board-on-drmingdrmergithubio) gives the exact commands.

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

## Step 2: fill a board folder with sync-vault.sh

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

## Step 3: mount the board in a post

Put the board's element and the script that mounts it into the post:

```html
<div id="raft-board" style="height:70vh;border:1px solid #ccc"></div>
<script type="module">
  import { mount } from 'https://drmingdrmer.github.io/obsidian-canvas-render/canvas-render.js'

  mount(document.getElementById('raft-board'), { canvas: '/boards/raft/raft.canvas', attachments: 'assets' })
</script>
```

- GitHub Pages serves `canvas-render.js` from the newest commit on this repository's `main`, so each change pushed there reaches the post at once. To keep one version, import the script from jsDelivr instead, with `<commit>` set to a commit sha of this repository: `https://cdn.jsdelivr.net/gh/drmingdrmer/obsidian-canvas-render@<commit>/canvas-render.js`.
- `canvas: '/boards/raft/raft.canvas'` starts with `/`, so it names the same file from any post. A path without the leading `/` is relative to the post's address.
- `attachments: 'assets'` names the same folder as the third argument of `sync-vault.sh`. Leave it out when you left that argument out.
- A post shows one board. A second `mount` on the same page fails.
- A click on a note card's title, on its `</>` icon, or on a wikilink to a note without a card shows the note inside the board, over the cards. The ← button above the note goes back to the cards.
- Over the board, the mouse wheel and a two-finger trackpad swipe scroll the post, as they do anywhere else on it. Ctrl or ⌘ with the wheel, or a pinch, zooms the board, and a drag on its background pans it. Alt with the wheel or the pinch enlarges or shrinks everything on the board but the text. The wheel scrolls a card only after a click on the card.
- Hugo drops raw HTML from Markdown unless the site config sets `markup.goldmark.renderer.unsafe = true`. Jekyll and Hexo keep it.

## Step 4: set the opening view

`mount` fits the whole board into its element, unless its second argument names another view:

- `focus: '<card id>'` fits the view to one card. A card's id is its `id` field in the `.canvas` file.
- `at: '<x>,<y>,<zoom>'` puts the canvas point `<x>,<y>` at the centre of the element, at that zoom of the text, where 1 is 100%.
- `spread: <n>` draws everything on the board but the text `<n>` times larger, from 1 to 4, so each card shows more of its note. It applies to the fitted view too.

To find these values, open the board on the renderer's own page, which writes its view into its address. The copy on GitHub Pages cannot read a board on another site, so serve the renderer on your machine. Copy the board folder into your clone of this repository, and start `serve.sh` there:

```bash
cp -r ~/blog/static/boards/raft ~/obsidian-canvas-render/
~/obsidian-canvas-render/serve.sh
```

Open `http://localhost:8000/?canvas=raft/raft.canvas&attachments=assets`, and move the board to the view the post needs. The address then ends in `at=<x>,<y>,<zoom>`. After a search or a wikilink fits the view to one card, it ends in `focus=<card id>` instead. Alt with the wheel or a pinch spreads the board, and adds `spread=<n>` to the address. Add these parameters to the second argument of `mount`, such as `{ canvas: '/boards/raft/raft.canvas', at: '120,40,0.8', spread: 2 }`. Adding `cards: 'compact'` draws every card at one compact size, which suits a narrow post.

## Example: a board on drmingdrmer.github.io

GitHub Pages builds `https://drmingdrmer.github.io/` with Jekyll, from the repository `drmingdrmer/drmingdrmer.github.io`. So, as Step 1 explains, the boards go into another repository, `drmingdrmer/canvas-boards`. GitHub Pages serves it at `https://drmingdrmer.github.io/canvas-boards/`, on the same site as the renderer and the blog.

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
     import { mount } from 'https://drmingdrmer.github.io/obsidian-canvas-render/canvas-render.js'

     mount(document.getElementById('apaxos-board'), { canvas: '/canvas-boards/apaxos/abstract-paxos.canvas', attachments: 'assets' })
   </script>
   ```

After you edit the board, run the `cp` and `sync-vault.sh` lines of step 1 again, then commit and push.

The renderer on GitHub Pages sits on the same site as these boards, so Step 4 needs no `serve.sh`. Open `https://drmingdrmer.github.io/obsidian-canvas-render/?canvas=/canvas-boards/apaxos/abstract-paxos.canvas&attachments=assets` to find the opening view.

## Reading a board from raw.githubusercontent.com

The renderer can also read a board straight out of a public GitHub repository, through `raw.githubusercontent.com`. That host sends `Access-Control-Allow-Origin: *`, which lets a page on any site read its files. The blog then serves no file of the board:

```js
mount(document.getElementById('raft-board'), {
  canvas: 'https://raw.githubusercontent.com/<user>/<repository>/refs/heads/main/boards/raft/raft.canvas',
  attachments: 'assets',
})
```

The renderer on GitHub Pages reads such a board too, so Step 4 needs no `serve.sh`. Open `https://drmingdrmer.github.io/obsidian-canvas-render/?canvas=https://raw.githubusercontent.com/<user>/<repository>/refs/heads/main/boards/raft/raft.canvas&attachments=assets` to find the opening view.

This way has two limits:

- A file card for a PDF, or for any other file that is neither a note nor an image, shows the browser's refusal instead of the file. The renderer shows such a file in a frame, and `raw.githubusercontent.com` forbids framing with `X-Frame-Options: deny`.
- GitHub limits how many files a signed-out reader may download from `raw.githubusercontent.com`, and does not publish the number ([changelog, 2025-05-08](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)). The board downloads one file per note card, so on a large board some cards may read `Cannot read … (HTTP 429)`.
