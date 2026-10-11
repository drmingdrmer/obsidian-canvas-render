const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { test, expect, ORIGIN, serveApp, openBoard } = require('./helpers')

const SERVE_SCRIPT = path.join(__dirname, '..', 'serve.sh')

// Asks the OS for a port that nothing listens on.
async function freePort() {
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  return port
}

test('the demo board, served by serve.sh, draws every card and edge, and loads every note', async ({ page }) => {
  const errors = []
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })

  // Counted from the file, so that editing the demo does not break the test.
  const demoPath = path.join(__dirname, '..', 'vault', 'demo.canvas')
  const demo = JSON.parse(fs.readFileSync(demoPath, 'utf8'))

  const port = await freePort()
  // serve.sh runs python3 as its child. detached gives the two a process group
  // of their own, so one kill stops both.
  const server = spawn('bash', [SERVE_SCRIPT, String(port)], { detached: true, stdio: 'ignore' })
  try {
    const url = `http://127.0.0.1:${port}/`
    const status = () => fetch(url).then(response => response.status, error => error.cause?.code)
    await expect.poll(status).toBe(200)
    await page.goto(url)
    await expect(page.locator('.canvas-node')).toHaveCount(demo.nodes.length)
    await expect(page.locator('.canvas-edge-line')).toHaveCount(demo.edges.length)
    // Each file card holds a placeholder until its note renders.
    await expect(page.locator('.canvas-node-placeholder')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    process.kill(-server.pid)
  }
})

test('a canvas on raw.githubusercontent.com reads its notes from beside it', async ({ page }) => {
  const base = 'https://raw.githubusercontent.com/u/r/main/b/'
  const cors = { 'access-control-allow-origin': '*' }
  const canvas = { nodes: [{ id: 'f', type: 'file', file: 'n.md', x: 0, y: 0, width: 300, height: 100 }] }
  await serveApp(page)
  await page.route(`${base}x.canvas`, route => route.fulfill({ json: canvas, headers: cors }))
  await page.route(`${base}n.md`, route => route.fulfill({ body: 'remote note', headers: cors }))
  await page.goto(`${ORIGIN}?canvas=${base}x.canvas`)

  await expect(page.locator('.canvas-node-content')).toHaveText('remote note')
  const vaultRoot = await page.evaluate(() => config.vaultRoot)
  expect(vaultRoot).toBe(base)
  const titleLink = page.locator('.canvas-node-title-link').first()
  await expect(titleLink).toHaveAttribute('href', '?note=https%3A%2F%2Fraw.githubusercontent.com%2Fu%2Fr%2Fmain%2Fb%2Fn.md')
})

test('the vault parameter sets where file cards read their notes', async ({ page }) => {
  const canvas = { nodes: [{ id: 'f', type: 'file', file: 'n.md', x: 0, y: 0, width: 300, height: 100 }] }
  await serveApp(page)
  await page.route('**/board/board.canvas', route => route.fulfill({ json: canvas }))
  await page.route('**/notes/n.md', route => route.fulfill({ body: 'from notes' }))
  await page.goto(`${ORIGIN}?canvas=board/board.canvas&vault=notes/`)

  await expect(page.locator('.canvas-node-content')).toHaveText('from notes')
  await expect(page.locator('.canvas-node-title-link').first()).toHaveAttribute('href', '?note=notes%2Fn.md')
})

test('a canvas that cannot be drawn shows why in the status line', async ({ page, expectedErrors }) => {
  expectedErrors.push(`HTTP 404 ${ORIGIN}board/none.canvas`)
  await serveApp(page)
  await page.route('**/board/list.canvas', route => route.fulfill({ json: [] }))
  await page.route('**/board/node-map.canvas', route => route.fulfill({ json: { nodes: {} } }))
  await page.route('**/board/bad.canvas', route => route.fulfill({ body: '{not json' }))
  const status = page.locator('#status')

  await page.goto(`${ORIGIN}?canvas=board/none.canvas`)
  await expect(status).toHaveText('Cannot read board/none.canvas (HTTP 404)')

  await page.goto(`${ORIGIN}?canvas=board/list.canvas`)
  await expect(status).toHaveText('canvas file is not a JSON object')

  await page.goto(`${ORIGIN}?canvas=board/node-map.canvas`)
  await expect(status).toHaveText('canvas file has a "nodes" field that is not an array')

  // The parser's own message follows, and its wording differs between browsers.
  await page.goto(`${ORIGIN}?canvas=board/bad.canvas`)
  await expect(status).toHaveText(/^Cannot parse board\/bad\.canvas: \S/)
})

test('a canvas without nodes draws an empty board', async ({ page }) => {
  await serveApp(page)
  await page.route('**/board/empty.canvas', route => route.fulfill({ json: {} }))
  await page.route('**/board/edges-only.canvas', route => route.fulfill({ json: { edges: [] } }))

  for (const name of ['empty.canvas', 'edges-only.canvas']) {
    await page.goto(`${ORIGIN}?canvas=board/${name}`)
    // An empty board draws no card to wait for; Grid is the last control main() installs.
    await expect.soft(page.locator('#grid-snap'), name).toHaveAttribute('aria-pressed', 'false')
    await expect.soft(page.locator('#status'), name).toBeHidden()
  }
})

test('a file card shows Loading… until its note arrives, or why it failed', async ({ page, expectedErrors }) => {
  expectedErrors.push(`HTTP 404 ${ORIGIN}board/gone.md`)
  let releaseNote
  const noteHeld = new Promise(resolve => {
    releaseNote = resolve
  })
  const heldNote = async route => {
    await noteHeld
    await route.fulfill({ body: 'late note' })
  }
  const nodes = [
    { id: 'held', type: 'file', file: 'held.md', x: 0, y: 0, width: 200, height: 100 },
    { id: 'gone', type: 'file', file: 'gone.md', x: 300, y: 0, width: 200, height: 100 },
    { id: 'down', type: 'file', file: 'down.md', x: 600, y: 0, width: 200, height: 100 },
  ]
  await openBoard(page, { nodes }, { 'held.md': heldNote, 'down.md': route => route.abort() })

  const contents = page.locator('.canvas-node-content')
  await expect(contents.nth(0)).toHaveText('Loading…')
  await expect(contents.nth(1)).toHaveText('Cannot load gone.md (HTTP 404)')
  const unreachable = 'Cannot reach board/down.md — the host is unreachable, or sends no CORS header for this page'
  await expect(contents.nth(2)).toHaveText(unreachable)

  releaseNote()
  await expect(contents.nth(0)).toHaveText('late note')
})
