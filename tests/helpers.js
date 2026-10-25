// Helpers for the browser tests of canvas-render.js. Run the tests from this
// directory: `npm install` and `npx playwright install chromium firefox webkit`
// once, then `npx playwright test`.

const fs = require('node:fs')
const path = require('node:path')
const { test: base, expect } = require('@playwright/test')

const APP_ROOT = path.join(__dirname, '..')
const ORIGIN = 'http://canvas.test/'

// The board is an ES module, which declares no globals. The tests read and call
// these internals of it, so the copy of src/board.js served to them puts them on
// window just before createBoard returns the board. An entry `name: expression`
// puts there one that a component of the board holds.
const INTERNALS = [
  'view', 'layout', 'config', 'CARD_SIZE_STORAGE_KEY', 'renderMarkdown', 'sliceSubpath: markdown.sliceSubpath',
  'linkedCard', 'markdownElement', 'splitTextNode: markdown.splitTextNode', 'applyView', 'zoomAt', 'applyCardSize',
  'preferredCardSize', 'drawCanvas', 'assertAllowedHost', 'resolveVaultRoot', 'resolveAttachments',
]
const BOARD_RETURN = '\n  return { boardFragment, main, showStatus }\n'
const EXPOSE_INTERNALS = `\n  Object.assign(window, { ${INTERNALS.join(', ')} })${BOARD_RETURN}`

// Whether an expected error, a string or a RegExp, matches an error message.
function matchesError(expected, error) {
  if (typeof expected === 'string') return expected === error
  return expected.test(error)
}

// A test fails on an error it does not expect: an uncaught exception or
// rejection on the page, or an error event on the window that carries no
// exception, read as its message, or a response with an HTTP error status,
// read as `HTTP <status> <url>`. A test that provokes one pushes a
// string equal to it, or a RegExp matching it, into expectedErrors, and then
// fails if it never happens.
const test = base.extend({
  expectedErrors: async ({}, use) => {
    await use([])
  },
  page: async ({ page, expectedErrors }, use) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    // Chromium and Firefox raise a ResizeObserver loop error only as such an
    // event, and no pageerror reports it.
    await page.exposeFunction('reportWindowError', message => errors.push(message))
    await page.addInitScript(() => {
      window.addEventListener('error', event => {
        // Such an event's error is null in Chromium, and undefined in Firefox.
        const carriesException = event.error !== null && event.error !== undefined
        if (!carriesException) window.reportWindowError(event.message)
      })
    })
    page.on('response', response => {
      if (response.status() < 400) return
      errors.push(`HTTP ${response.status()} ${response.url()}`)
    })
    const mismatch = () => {
      const unexpected = errors.filter(error => !expectedErrors.some(expected => matchesError(expected, error)))
      const missing = expectedErrors.filter(expected => !errors.some(error => matchesError(expected, error)))
      return { unexpected, missing }
    }
    await use(page)
    // An expected error can arrive after the test's last step, so this waits for it.
    await expect.poll(mismatch).toEqual({ unexpected: [], missing: [] })
  },
})

// Answers the page's requests from the repository on disk. No server runs,
// so no connection can be refused.
async function serveApp(page) {
  await page.route(`${ORIGIN}**`, route => {
    const url = new URL(route.request().url())
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)
    const file = path.join(APP_ROOT, relative)
    if (!fs.existsSync(file)) return route.fulfill({ status: 404 })
    if (relative === '/src/board.js') {
      const parts = fs.readFileSync(file, 'utf8').split(BOARD_RETURN)
      if (parts.length !== 2) throw new Error(`createBoard in src/board.js must end with${BOARD_RETURN}`)
      return route.fulfill({ body: parts.join(EXPOSE_INTERNALS), contentType: 'text/javascript' })
    }
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
  // Grid shows its state last in main(), after every card is drawn, so this wait
  // holds even for a board with no card to count.
  await expect(page.locator('#grid-snap')).toHaveAttribute('aria-pressed', /^(true|false)$/)
  await expect(page.locator('.canvas-node')).toHaveCount(canvas.nodes.length)
}

function textCard(id, x, y, text) {
  return { id, type: 'text', x, y, width: 200, height: 100, text }
}

// Presses at (x, y), moves by (dx, dy) and releases, in page pixels.
async function dragBy(page, x, y, dx, dy) {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy)
  await page.mouse.up()
}

// Each node's [x, y, width, height] in canvas units, keyed by node id.
function boxes(page) {
  return page.evaluate(() => {
    const entries = layout.nodes.map(node => [node.id, [node.x, node.y, node.width, node.height]])
    return Object.fromEntries(entries)
  })
}

module.exports = { test, expect, ORIGIN, serveApp, openBoard, textCard, dragBy, boxes }
