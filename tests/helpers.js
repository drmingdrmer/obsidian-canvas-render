// Helpers for the browser tests of canvas-render.js. Run the tests from this
// directory: `npm install` and `npx playwright install chromium` once, then
// `npx playwright test`.

const fs = require('node:fs')
const path = require('node:path')
const { expect } = require('@playwright/test')

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
// registered later is tried first, so these win over the files on disk. A note
// is its text, or a route handler that answers the request itself.
async function openBoard(page, canvas, notes = {}, query = '') {
  await serveApp(page)
  await page.route('**/board/board.canvas', route => route.fulfill({ json: canvas }))
  for (const [notePath, note] of Object.entries(notes)) {
    const handler = typeof note === 'function' ? note : route => route.fulfill({ body: note })
    await page.route(`**/board/${notePath}`, handler)
  }
  await page.goto(`${ORIGIN}?canvas=board/board.canvas${query}`)
  // main() draws the cards and installs every control in one task.
  await expect(page.locator('.canvas-node')).toHaveCount(canvas.nodes.length)
}

function textCard(id, x, y, text) {
  return { id, type: 'text', x, y, width: 200, height: 100, text }
}

module.exports = { ORIGIN, serveApp, openBoard, textCard }
