const fs = require('node:fs')
const path = require('node:path')
const { test, expect, textCard } = require('./helpers')

const APP_ROOT = path.join(__dirname, '..')
const SITE = 'http://blog.test'
const POST_URL = `${SITE}/posts/post.html`

// A blog post that mounts a board 300 px down and 100 px in. Its styles would
// change the board if they reached it, and it has an element of its own that
// the board's stylesheet would move. `post` is the one global the page sets.
const POST = `<!doctype html>
<html data-theme="page">
<head>
<style>
  body { margin: 0; letter-spacing: 5px; }
  .canvas-node { word-spacing: 9px; }
  #board { height: 400px; margin: 300px 0 0 100px; }
</style>
</head>
<body>
<p class="canvas-status" id="page-text">page text</p>
<div id="board"></div>
<div style="height: 2000px"></div>
<script>window.post = { globalsBefore: Object.keys(window) }</script>
<script type="module">
  import { mount } from '/canvas/canvas-render.js'
  post.mount = mount
  post.mounted = mount(document.getElementById('board'), { canvas: '../boards/b/board.canvas', attachments: 'assets' })
</script>
</body>
</html>`

// Card a holds 40 lines, which overflow its 100-unit height, so it can scroll.
const LINES = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n\n')
const BOARD = {
  nodes: [textCard('a', 0, 0, `A\n${LINES}`), { id: 'n', type: 'file', file: 'n.md', x: 300, y: 0, width: 200, height: 100 }],
}

// Note n, the one note with a card, links to note m, which has none, and to a
// note that is missing. Note m links back to n.
const NOTE = '# Note\n\n[[m]] [[gone]]'

// Serves the post, the renderer at /canvas/ as it is on disk, and the board
// and its notes at /boards/b/, then waits for the board to be drawn.
async function openPost(page) {
  await page.route(`${SITE}/**`, route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/posts/post.html') return route.fulfill({ body: POST, contentType: 'text/html' })
    if (url.pathname === '/boards/b/board.canvas') return route.fulfill({ json: BOARD })
    if (url.pathname === '/boards/b/n.md') return route.fulfill({ body: NOTE })
    if (url.pathname === '/boards/b/m.md') return route.fulfill({ body: '# M\n\n[[n]]' })
    if (!url.pathname.startsWith('/canvas/')) return route.fulfill({ status: 404 })

    const relative = decodeURIComponent(url.pathname.slice('/canvas/'.length)) || 'index.html'
    const file = path.join(APP_ROOT, relative)
    if (!fs.existsSync(file)) return route.fulfill({ status: 404 })
    return route.fulfill({ path: file })
  })
  await page.goto(POST_URL)
  await page.evaluate(() => post.mounted)
}

test('a mounted board draws its cards, and keeps its styles and the page styles apart', async ({ page }) => {
  await openPost(page)
  await expect(page.locator('.canvas-node')).toHaveCount(2)
  await expect(page.locator('.canvas-node-placeholder')).toHaveCount(0)

  const card = page.locator('.canvas-node').first()
  await expect(card).toHaveCSS('letter-spacing', 'normal')
  await expect(card).toHaveCSS('word-spacing', '0px')
  await expect(page.locator('#page-text')).toHaveCSS('position', 'static')
})

test('mount adds no global but the libraries it loads', async ({ page }) => {
  await openPost(page)
  const added = await page.evaluate(() => Object.keys(window).filter(key => !post.globalsBefore.includes(key)))
  expect(added.sort()).toEqual(['DOMPurify', 'katex', 'marked', 'post'])
})

test('a plain wheel over a mounted board scrolls the page, even over a card that could scroll', async ({ page }) => {
  await openPost(page)
  const card = page.locator('.canvas-node').first()
  const before = await card.boundingBox()
  await card.locator('.canvas-node-content').hover()

  await page.mouse.wheel(0, 200)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200)
  // The board moved with the page, and its view stayed where it was.
  const after = await card.boundingBox()
  expect(after).toEqual({ ...before, y: before.y - 200 })
})

test('a plain wheel over the focused card of a mounted board scrolls the card', async ({ page }) => {
  await openPost(page)
  const content = page.locator('.canvas-node-content').first()
  await content.click()

  // Firefox scrolls at most 90% of the 55 px content box per wheel event.
  await page.mouse.wheel(0, 40)
  await expect.poll(() => content.evaluate(el => el.scrollTop)).toBe(40)
  const scrollY = await page.evaluate(() => window.scrollY)
  expect(scrollY).toBe(0)
})

test('Space enlarges the focused card of a mounted board only while the pointer is over the board', async ({ page }) => {
  await openPost(page)
  const card = page.locator('.canvas-node').first()
  await card.locator('.canvas-node-content').click()
  // Added after the board's own listener, so it sees whether the board took the key.
  await page.evaluate(() => {
    document.addEventListener('keydown', event => {
      post.spaceTaken = event.defaultPrevented
    })
  })

  // Left of the board, which starts 100 px in.
  await page.mouse.move(50, 400)
  await page.keyboard.press('Space')
  const takenOffBoard = await page.evaluate(() => post.spaceTaken)
  expect(takenOffBoard).toBe(false)
  await expect(card).not.toHaveAttribute('data-enlarged')

  await card.locator('.canvas-node-content').hover()
  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  const takenOnBoard = await page.evaluate(() => post.spaceTaken)
  expect(takenOnBoard).toBe(true)
  await page.keyboard.press('Space')
  await expect(card).not.toHaveAttribute('data-enlarged')
})

test('a mounted board zooms around the pointer, and keeps its view out of the address', async ({ page }) => {
  await openPost(page)
  const card = page.locator('.canvas-node').first()
  const before = await card.boundingBox()
  // Whole pixels, as Firefox rounds the pointer to them.
  const pointerX = Math.round(before.x + before.width / 2)
  const pointerY = Math.round(before.y + before.height / 2)
  await page.mouse.move(pointerX, pointerY)

  // A wheel of 400 doubles or halves the zoom, so -100 multiplies it by e^0.25.
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await card.boundingBox()).width / before.width).toBeCloseTo(Math.exp(0.25))
  // The point of the card under the pointer stays under it.
  const after = await card.boundingBox()
  const scale = after.width / before.width
  expect(after.x + (pointerX - before.x) * scale).toBeCloseTo(pointerX, 1)
  expect(after.y + (pointerY - before.y) * scale).toBeCloseTo(pointerY, 1)

  // A board that owns its page writes the view into the address 300 ms after it settles.
  await page.waitForTimeout(600)
  expect(page.url()).toBe(POST_URL)
})

test('the theme goes on the element the board is mounted in', async ({ page }) => {
  await openPost(page)
  const board = page.locator('#board')
  await expect(board).toHaveAttribute('data-theme', 'light')

  await page.locator('.canvas-controls .theme-toggle').click()
  await expect(board).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.canvas-background')).toHaveCSS('background-color', 'rgb(22, 22, 22)')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'page')
})

test('a note link opens the renderer page, with each path from the site root', async ({ page }) => {
  await openPost(page)
  const href = `${SITE}/canvas/?note=%2Fboards%2Fb%2Fn.md&vault=%2Fboards%2Fb%2F&attachments=assets%2F`
  await expect(page.locator('.canvas-node-title-link').first()).toHaveAttribute('href', href)

  await page.goto(href)
  await expect(page.locator('#file-view-body h1')).toHaveText('Note')
})

test('a note link on a mounted board shows the note inside the board, until ← goes back', async ({ page }) => {
  await openPost(page)
  await page.locator('.canvas-node-title-link').first().click()

  await expect(page.locator('#file-view-body h1')).toHaveText('Note')
  await expect(page.locator('#file-view-back')).toBeVisible()
  await expect(page.locator('#wrapper')).toHaveAttribute('inert', '')
  expect(page.url()).toBe(POST_URL)
  expect(page.context().pages()).toHaveLength(1)

  await page.locator('#file-view-back').click()
  await expect(page.locator('#file-view')).toBeHidden()
  await expect(page.locator('#wrapper')).not.toHaveAttribute('inert')
  await expect(page.locator('.canvas-node')).toHaveCount(2)
})

test('the source icon and the toggle of a mounted board switch the note in place', async ({ page }) => {
  await openPost(page)
  await page.locator('.canvas-node-source-link').click()
  const toggle = page.locator('#file-view-toggle')
  await expect(toggle).toHaveText('Rendered')
  const source = await page.locator('.file-view-source').textContent()
  expect(source).toBe(NOTE)

  await toggle.click()
  await expect(page.locator('#file-view-body h1')).toHaveText('Note')
  await expect(toggle).toHaveText('Source')
  expect(page.url()).toBe(POST_URL)
})

test('a wikilink in the note view opens a note without a card there, and previews one with a card on the board', async ({ page }) => {
  await openPost(page)
  await page.locator('.canvas-node-title-link').first().click()
  await page.locator('#file-view-body .internal-link[title="m"]').click()
  await expect(page.locator('#file-view-body h1')).toHaveText('M')

  const link = page.locator('#file-view-body .internal-link[title="n"]')
  await link.click()
  const preview = page.locator('#card-preview')
  await expect(preview.locator('h1')).toHaveText('Note')
  // The board sits 100 px in and 300 px down the page, and the preview 8 px below the link.
  const linkBox = await link.boundingBox()
  const box = await preview.boundingBox()
  expect(box.x).toBeCloseTo(linkBox.x, 1)
  expect(box.y).toBeCloseTo(linkBox.y + linkBox.height + 8, 1)

  // A link in the preview to a note without a card opens the note in the note view.
  await preview.locator('.internal-link[title="m"]').click()
  await expect(preview).toBeHidden()
  await expect(page.locator('#file-view-body h1')).toHaveText('M')

  await link.click()
  await page.locator('#card-preview-go').click()
  await expect(preview).toBeHidden()
  await expect(page.locator('#file-view')).toBeHidden()
  await expect(page.locator('.canvas-node[data-type="file"]')).toHaveAttribute('data-focused', 'true')
})

test('a note that cannot be read says why inside the board', async ({ page, expectedErrors }) => {
  expectedErrors.push(`HTTP 404 ${SITE}/boards/b/gone.md`)
  await openPost(page)
  await page.locator('.canvas-node-title-link').first().click()
  await page.locator('#file-view-body .internal-link[title="gone"]').click()
  await expect(page.locator('#file-view-body')).toHaveText('Cannot read ../boards/b/gone.md (HTTP 404)')
})

test('a page shows one board, so a second mount fails', async ({ page }) => {
  await openPost(page)
  const message = await page.evaluate(() => post.mount(document.body, {}).catch(error => error.message))
  expect(message).toBe('mount draws one board per page, and this page has one')
})
