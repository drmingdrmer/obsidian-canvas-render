const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { test, expect, ORIGIN, serveApp, openBoard, textCard } = require('./helpers')

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
    // A press in the search box draws every card, and each file card holds a
    // placeholder until its note renders.
    await page.locator('#search').click()
    await expect(page.locator('.canvas-node-placeholder')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    process.kill(-server.pid)
  }
})

test('the page asks for every module in src/ and every library before src/board.js arrives', async ({ page }) => {
  const modules = fs.readdirSync(path.join(__dirname, '..', 'src')).map(name => `/src/${name}`)
  const libraries = ['/lib/marked.min.js', '/lib/katex/katex.min.js', '/lib/purify.min.js']
  const requested = new Set()
  page.on('request', request => {
    const { pathname } = new URL(request.url())
    if (pathname.endsWith('.js') && pathname !== '/canvas-render.js') requested.add(pathname)
  })

  // A module that only an import of src/board.js names stays unasked while
  // src/board.js is held back.
  let release
  const held = new Promise(resolve => {
    release = resolve
  })
  await serveApp(page)
  await page.route(`${ORIGIN}src/board.js`, async route => {
    await held
    await route.fallback()
  })
  await page.route('**/board/board.canvas', route => route.fulfill({ json: { nodes: [textCard('a', 0, 0, 'A')] } }))
  // The page does not finish loading while src/board.js is held back.
  await page.goto(`${ORIGIN}?canvas=board/board.canvas`, { waitUntil: 'commit' })

  const expected = [...modules, ...libraries].sort()
  await expect.poll(() => [...requested].sort()).toEqual(expected)
  release()
  await expect(page.locator('.canvas-node')).toHaveCount(1)
})

test('a library that fails to load before src/board.js arrives shows why in the status line', async ({ page, expectedErrors }) => {
  const libraryUrl = `${ORIGIN}lib/marked.min.js`
  expectedErrors.push(`HTTP 404 ${libraryUrl}`)
  // A script's error event does not bubble, so this catches it on its way down from the window.
  await page.addInitScript(() => {
    window.addEventListener('error', event => {
      if (event.target.src?.endsWith('/lib/marked.min.js')) window.libraryFailed = true
    }, true)
  })
  await serveApp(page)
  await page.route(libraryUrl, route => route.fulfill({ status: 404 }))
  await page.route(`${ORIGIN}src/board.js`, async route => {
    await page.waitForFunction(() => window.libraryFailed)
    await route.fallback()
  })
  await page.goto(ORIGIN, { waitUntil: 'commit' })

  await expect(page.locator('#status')).toHaveText(`Cannot load ${libraryUrl}`)
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

// [a canvas that drawCanvas refuses, the message it shows]
const BROKEN_CANVASES = [
  [{ edges: {} }, 'canvas file has an "edges" field that is not an array'],
  [{ nodes: [null] }, 'node 0 is not a JSON object'],
  [{ nodes: [{ ...textCard('a', 0, 0, 'A'), id: 7 }] }, 'node 0 needs a string in "id"'],
  [{ nodes: [textCard('a', 0, 0, 'A'), textCard('a', 300, 0, 'B')] }, 'two nodes have the id "a"'],
  [{ nodes: [{ ...textCard('a', 0, 0, 'A'), type: undefined }] }, 'node "a" needs a string in "type"'],
  [{ nodes: [{ ...textCard('a', 0, 0, 'A'), x: '0' }] }, 'node "a" needs a number in "x"'],
  [{ nodes: [{ ...textCard('a', 0, 0, 'A'), height: null }] }, 'node "a" needs a number in "height"'],
  [{ nodes: [{ ...textCard('a', 0, 0, 'A'), text: undefined }] }, 'node "a" needs a string in "text"'],
  [{ nodes: [{ id: 'f', type: 'file', x: 0, y: 0, width: 300, height: 100 }] }, 'node "f" needs a string in "file"'],
  [{ nodes: [{ id: 'l', type: 'link', x: 0, y: 0, width: 300, height: 100 }] }, 'node "l" needs a string in "url"'],
  [{ nodes: [textCard('a', 0, 0, 'A')], edges: [null] }, 'edge 0 is not a JSON object'],
  [{ nodes: [textCard('a', 0, 0, 'A'), { ...textCard('b', 300, 0, 'B'), color: 7 }] }, 'node "b" needs a string in "color"'],
  [{ nodes: [{ id: 'f', type: 'file', file: 'n.md', subpath: 7, x: 0, y: 0, width: 300, height: 100 }] }, 'node "f" needs a string in "subpath"'],
  [{ nodes: [{ id: 'g', type: 'group', label: 7, x: 0, y: 0, width: 300, height: 100 }] }, 'node "g" needs a string in "label"'],
  [{ nodes: [{ id: 'g', type: 'group', background: 7, x: 0, y: 0, width: 300, height: 100 }] }, 'node "g" needs a string in "background"'],
  [{ nodes: [textCard('a', 0, 0, 'A'), textCard('b', 300, 0, 'B')], edges: [{ id: 'e', fromNode: 'a', toNode: 'b', fromSide: 'sideways' }] }, 'edge "e" needs top, right, bottom or left in "fromSide"'],
  [{ nodes: [textCard('a', 0, 0, 'A'), textCard('b', 300, 0, 'B')], edges: [{ fromNode: 'a', toNode: 'b', toSide: 'toString' }] }, 'edge 0 needs top, right, bottom or left in "toSide"'],
  [{ nodes: [textCard('a', 0, 0, 'A'), textCard('b', 300, 0, 'B')], edges: [{ id: 'e', fromNode: 'a', toNode: 'b', color: 7 }] }, 'edge "e" needs a string in "color"'],
  [{ nodes: [textCard('a', 0, 0, 'A'), textCard('b', 300, 0, 'B')], edges: [{ id: 'e', fromNode: 'a', toNode: 'b', label: 7 }] }, 'edge "e" needs a string in "label"'],
]

test('a canvas with a broken node or edge names it and the field, and draws nothing', async ({ page }) => {
  let canvas = null
  await serveApp(page)
  await page.route('**/board/broken.canvas', route => route.fulfill({ json: canvas }))
  for (const [broken, message] of BROKEN_CANVASES) {
    canvas = broken
    await page.goto(`${ORIGIN}?canvas=board/broken.canvas`)
    await expect.soft(page.locator('#status'), message).toHaveText(message)
    await expect.soft(page.locator('.canvas-node'), message).toHaveCount(0)
  }
})

test('optional fields set to null draw as if they were left out', async ({ page }) => {
  const canvas = {
    nodes: [
      { ...textCard('a', 0, 0, 'A'), color: null },
      { id: 'g', type: 'group', label: null, background: null, x: 0, y: 200, width: 300, height: 100 },
      { id: 'f', type: 'file', file: 'n.md', subpath: null, x: 400, y: 0, width: 300, height: 100 },
    ],
    edges: [{ id: 'e', fromNode: 'a', toNode: 'f', fromSide: null, toSide: null, color: null, label: null }],
  }
  await openBoard(page, canvas, { 'n.md': 'the note' })
  await expect(page.locator('.canvas-node')).toHaveCount(3)
  await expect(page.locator('.canvas-edge-line')).toHaveCount(1)
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
  await expect(contents.nth(1)).toHaveText('Cannot read gone.md (HTTP 404)')
  const unreachable = 'Cannot reach board/down.md — the host is unreachable, or sends no CORS header for this page'
  await expect(contents.nth(2)).toHaveText(unreachable)

  releaseNote()
  await expect(contents.nth(0)).toHaveText('late note')
})

test('a card in view shows its title alone on a board drawn below 50%, and loads its note at 50%', async ({ page }) => {
  let requests = 0
  const note = route => {
    requests += 1
    return route.fulfill({ body: 'the note' })
  }
  const nodes = [{ id: 'n', type: 'file', file: 'n.md', x: 0, y: 0, width: 200, height: 100 }]
  // The card's centre, the canvas point (100, 50), is at the centre of the
  // 1280 × 720 window.
  await openBoard(page, { nodes }, { 'n.md': note }, '&at=100,50,0.4')
  const content = page.locator('.canvas-node-content')
  await expect(page.locator('.canvas-node-title-text')).toHaveText('n')
  await expect(content).toBeEmpty()
  expect(requests).toBe(0)

  await page.evaluate(() => zoomAt(640, 360, 0.5))
  await expect(content).toHaveText('the note')
  expect(requests).toBe(1)
})

test('text drawn larger makes up for a smaller zoom', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('t', 0, 0, 'Head\nbody')] }, {}, '&at=100,50,0.3')
  const content = page.locator('.canvas-node-content')
  await expect(content).toBeEmpty()

  // Six steps draw the text 1.81 times its size, so the board drawn at 30%
  // counts as drawn at 54%.
  for (let step = 0; step < 6; step++) await page.locator('#text-larger').click()
  await expect(content).toHaveText('body')
})

test('a card out of view loads its note once the view pans to it', async ({ page }) => {
  let requests = 0
  const note = route => {
    requests += 1
    return route.fulfill({ body: 'the far note' })
  }
  const nodes = [textCard('a', 0, 0, 'A\nnear'), { id: 'f', type: 'file', file: 'far.md', x: 2000, y: 0, width: 200, height: 100 }]
  // At 100%, card a is at the centre of the window, and card f 1900 px right
  // of it, out of view.
  await openBoard(page, { nodes }, { 'far.md': note }, '&at=100,50,1')
  const contents = page.locator('.canvas-node-content')
  await expect(contents.nth(0)).toHaveText('near')
  await expect(contents.nth(1)).toBeEmpty()
  expect(requests).toBe(0)

  await page.evaluate(() => {
    view.x -= 2000
    applyView()
  })
  await expect(contents.nth(1)).toHaveText('the far note')
  expect(requests).toBe(1)
})

test('a card that a refit brings into view draws what it holds without a ResizeObserver loop error', async ({ page }) => {
  let releaseNote
  const noteHeld = new Promise(resolve => {
    releaseNote = resolve
  })
  const heldNote = async route => {
    await noteHeld
    const paragraphs = Array.from({ length: 40 }, (_, i) => `para ${i}`)
    await route.fulfill({ body: paragraphs.join('\n\n') })
  }
  const nodes = [
    { id: 'f', type: 'file', file: 'f.md', x: 0, y: 0, width: 200, height: 100 },
    textCard('t', 0, 400, 'T\nbelow'),
  ]
  // The view fits card f, and card t lies below the window. The note grows f
  // to Compact's cap, the view fits f again, and t comes into view.
  await openBoard(page, { nodes }, { 'f.md': heldNote }, '&cards=compact&focus=f')
  const below = page.locator('.canvas-node-content').nth(1)
  await expect(below).toBeEmpty()

  releaseNote()
  await expect(below).toHaveText('below')
})

test('a card that a wider window brings into view loads its note', async ({ page }) => {
  const nodes = [textCard('a', 0, 0, 'A\nnear'), { id: 'f', type: 'file', file: 'far.md', x: 2000, y: 0, width: 200, height: 100 }]
  // At 100%, card f starts 2540 px right of the window's left edge, out of
  // view. A view that a link names keeps its corner as the window grows.
  await openBoard(page, { nodes }, { 'far.md': 'the far note' }, '&at=100,50,1')
  const far = page.locator('.canvas-node-content').nth(1)
  await expect(far).toBeEmpty()

  await page.setViewportSize({ width: 3000, height: 720 })
  await expect(far).toHaveText('the far note')
})
