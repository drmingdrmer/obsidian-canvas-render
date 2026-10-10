// Browser tests for canvas-render.js. Run from this directory: `npm install`
// and `npx playwright install chromium` once, then `npx playwright test`.

const fs = require('node:fs')
const path = require('node:path')
const { test, expect } = require('@playwright/test')

const APP_ROOT = path.join(__dirname, '..')
const ORIGIN = 'http://canvas.test/'

// Answers the page's requests from the repository on disk. No server runs,
// so no connection can be refused.
async function serveApp(page) {
  await page.route(`${ORIGIN}**`, route => {
    const url = new URL(route.request().url())
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)
    const file = path.join(APP_ROOT, relative)
    if (!fs.existsSync(file)) return route.fulfill({ status: 404 })
    return route.fulfill({ path: file })
  })
}

// Opens a board whose canvas and notes come from the test itself. A route
// registered later is tried first, so these win over the files on disk.
async function openBoard(page, canvas, notes = {}) {
  await serveApp(page)
  await page.route('**/board/board.canvas', route => route.fulfill({ json: canvas }))
  for (const [notePath, text] of Object.entries(notes)) {
    await page.route(`**/board/${notePath}`, route => route.fulfill({ body: text }))
  }
  await page.goto(`${ORIGIN}?canvas=board/board.canvas`)
  // main() draws the cards and installs every control in one task.
  await expect(page.locator('.canvas-node')).toHaveCount(canvas.nodes.length)
}

function textCard(id, x, y, text) {
  return { id, type: 'text', x, y, width: 200, height: 100, text }
}

test('splitTextNode lifts a prose first line into the header', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const split = await page.evaluate(() => splitTextNode('Title\nbody'))
  expect(split).toEqual({ header: 'Title', body: 'body' })
})

test('with Grid on, a dragged card lands on the 20 px grid', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody')] })
  await page.locator('#grid-snap').click()

  // A board this small opens at zoom 1, so a screen pixel is a canvas unit.
  const header = await page.locator('.canvas-node-header').boundingBox()
  const pressX = header.x + 10
  const pressY = header.y + 5
  await page.mouse.move(pressX, pressY)
  await page.mouse.down()
  await page.mouse.move(pressX + 33, pressY + 47)
  await page.mouse.up()

  const position = await page.evaluate(() => {
    const node = layout.nodes[0]
    return { x: node.x, y: node.y }
  })
  expect(position).toEqual({ x: 40, y: 40 })
})

test('a file card renders its note, math included', async ({ page }) => {
  const note = { id: 'n', type: 'file', file: 'n.md', x: 0, y: 0, width: 300, height: 200 }
  await openBoard(page, { nodes: [note] }, { 'n.md': 'Euler: $e^{i\\pi}+1=0$' })
  await expect(page.locator('.canvas-node-content .katex')).toHaveCount(1)
})

test('an edge with no sides joins the sides that face each other', async ({ page }) => {
  await openBoard(page, {
    nodes: [textCard('a', 0, 0, 'A'), textCard('b', 400, 0, 'B'), textCard('c', 0, 300, 'C')],
    edges: [
      { id: 'ab', fromNode: 'a', toNode: 'b' },
      { id: 'ac', fromNode: 'a', toNode: 'c' },
    ],
  })

  // A's right side to B's left side, and A's bottom to C's top. Both gaps are
  // 200 units, so each control point sits 70 units (35%) out from its end.
  const lines = page.locator('.canvas-edge-line')
  await expect(lines.nth(0)).toHaveAttribute('d', 'M 200 50 C 270 50, 330 50, 400 50')
  await expect(lines.nth(1)).toHaveAttribute('d', 'M 100 100 C 100 170, 100 230, 100 300')
})
