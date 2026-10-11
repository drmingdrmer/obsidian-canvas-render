const { test, expect, openBoard, textCard, boxes } = require('./helpers')

// A card eases into a new size over 150 ms, unless the reader asks for less
// motion; then a size read right after the change is already the final one.
test.use({ reducedMotion: 'reduce' })

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>'
const LONG_TEXT = `Head\n${Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n\n')}`
const LONG_NOTE = Array.from({ length: 40 }, (_, i) => `para ${i}`).join('\n\n')

// Drawn groups first, so the DOM order is g, short, long, link, image.
const BOARD = {
  nodes: [
    { id: 'g', type: 'group', x: -50, y: -50, width: 1500, height: 700, label: 'G' },
    textCard('short', 0, 0, 'Head\nshort body'),
    textCard('long', 300, 0, LONG_TEXT),
    { id: 'link', type: 'link', url: 'https://example.com/', x: 600, y: 0, width: 300, height: 200 },
    { id: 'image', type: 'file', file: 'pic.svg', x: 1000, y: 0, width: 300, height: 300 },
  ],
}

// [size, card width, height cap, the image's width and height]
const SIZES = [
  ['wide', 520, 480, [518, 259]],
  ['compact', 320, 240, [318, 159]],
]

async function openSizedBoard(page, query = '') {
  await page.route('https://example.com/**', route => route.fulfill({ body: '<p>page</p>', contentType: 'text/html' }))
  const image = route => route.fulfill({ body: SVG, contentType: 'image/svg+xml' })
  await openBoard(page, BOARD, { 'pic.svg': image }, query)
  await expect(page.locator('.canvas-node-image')).toHaveJSProperty('naturalWidth', 100)
}

// The height the image card needs: its title row and its image, inside its border.
function imageCardHeight(page) {
  return page.locator('.canvas-node[data-type="file"]').evaluate(el => {
    const title = el.querySelector('.canvas-node-title')
    const image = el.querySelector('.canvas-node-image')
    const border = el.offsetHeight - el.clientHeight
    return title.offsetHeight + image.offsetHeight + border
  })
}

for (const [size, width, cap, imageSize] of SIZES) {
  test(`${size} draws every card but a group ${width} wide, and as tall as its content up to ${cap}`, async ({ page }) => {
    await openSizedBoard(page)
    await page.locator(`[data-card-size="${size}"]`).click()

    // An iframe has no height of its own, so the link card takes the cap.
    const shortHeight = await page.locator('.canvas-node').nth(1).evaluate(el => el.offsetHeight)
    const imageHeight = await imageCardHeight(page)
    const sized = await boxes(page)
    expect(sized).toEqual({
      g: [-50, -50, 1500, 700],
      short: [0, 0, width, shortHeight],
      long: [300, 0, width, cap],
      link: [600, 0, width, cap],
      image: [1000, 0, width, imageHeight],
    })
    expect(shortHeight).toBeLessThan(cap)

    const image = await page.locator('.canvas-node-image').evaluate(el => [el.offsetWidth, el.offsetHeight])
    expect(image).toEqual(imageSize)
    const sizedBy = await page.locator('.canvas-node').evaluateAll(els => els.map(el => el.dataset.sized ?? null))
    expect(sizedBy).toEqual([null, 'content', 'content', null, 'content'])
  })
}

test('Actual gives every card back the size the file gives it', async ({ page }) => {
  await openSizedBoard(page)
  const authored = await boxes(page)
  await page.locator('[data-card-size="wide"]').click()
  await page.locator('[data-card-size="actual"]').click()

  const restored = await boxes(page)
  expect(restored).toEqual(authored)
})

test('a size button shows its state, and a reload keeps the size', async ({ page }) => {
  await openSizedBoard(page)
  await page.locator('[data-card-size="compact"]').click()
  const pressed = await page.locator('[data-card-size]').evaluateAll(els => els.map(el => el.getAttribute('aria-pressed')))
  expect(pressed).toEqual(['false', 'false', 'true'])
  const stored = await page.evaluate(() => localStorage.getItem('canvas-render-card-size'))
  expect(stored).toBe('compact')

  await page.reload()
  await expect(page.locator('[data-card-size="compact"]')).toHaveAttribute('aria-pressed', 'true')
  const cardSize = await page.evaluate(() => config.cardSize)
  expect(cardSize).toBe('compact')
})

test('the cards parameter sets the size for one load and stores nothing', async ({ page }) => {
  await openSizedBoard(page, '&cards=compact')
  await expect(page.locator('[data-card-size="compact"]')).toHaveAttribute('aria-pressed', 'true')
  const sized = await boxes(page)
  expect(sized.short[2]).toBe(320)
  const stored = await page.evaluate(() => localStorage.getItem('canvas-render-card-size'))
  expect(stored).toBeNull()
})

test('a size change re-routes the edges', async ({ page }) => {
  await openBoard(page, {
    nodes: [textCard('a', 0, 0, 'A\nbody'), textCard('b', 600, 0, 'B\nbody')],
    edges: [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
  })
  const line = page.locator('.canvas-edge-line')
  await expect(line).toHaveAttribute('d', 'M 200 50 C 340 50, 460 50, 600 50')
  await page.locator('[data-card-size="compact"]').click()

  // From A's right side, now at x 320, to B's left side, still at x 600.
  await expect(line).toHaveAttribute('d', /^M 320 [\d.]+ C .* 600 [\d.]+$/)
})

test('a size change routes each edge once, though both its cards changed size', async ({ page }) => {
  await openBoard(page, {
    nodes: [textCard('a', 0, 0, 'A\nbody'), textCard('b', 600, 0, 'B\nbody')],
    edges: [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
  })
  const routed = await page.evaluate(() => {
    const route = layoutEdge
    const edgeIds = []
    window.layoutEdge = record => {
      edgeIds.push(record.edge.id)
      route(record)
    }
    applyCardSize('compact')
    window.layoutEdge = route
    return edgeIds
  })
  expect(routed).toEqual(['ab'])
})

// Opens a Wide board whose file card stays at "Loading…" until the returned
// function is called.
async function openWithHeldNote(page) {
  let releaseNote
  const noteHeld = new Promise(resolve => {
    releaseNote = resolve
  })
  const heldNote = async route => {
    await noteHeld
    await route.fulfill({ body: LONG_NOTE })
  }
  const fileCard = { id: 'f', type: 'file', file: 'n.md', x: 0, y: 200, width: 300, height: 100 }
  await openBoard(page, { nodes: [textCard('t', 0, 0, 'T\nbody'), fileCard] }, { 'n.md': heldNote }, '&cards=wide')
  return releaseNote
}

test('a note that lands after the opening fit refits the view', async ({ page }) => {
  const releaseNote = await openWithHeldNote(page)
  const zoomBefore = await page.evaluate(() => view.zoom)
  expect(zoomBefore).toBe(1)
  releaseNote()

  // The file card grows to the cap, so the board runs from y 0 to 680.
  await expect.poll(async () => (await boxes(page)).f).toEqual([0, 200, 520, 480])
  await expect.poll(() => page.evaluate(() => view.zoom)).toBeCloseTo(600 / 680)
})

test('a note that lands after the reader moved the view leaves the view alone', async ({ page }) => {
  const releaseNote = await openWithHeldNote(page)
  const fitted = await page.evaluate(() => ({ ...view }))
  await page.mouse.move(640, 700)
  await page.mouse.wheel(0, 10)
  await expect.poll(() => page.evaluate(() => view.y)).toBe(fitted.y - 10)
  releaseNote()

  await expect.poll(async () => (await boxes(page)).f).toEqual([0, 200, 520, 480])
  const viewAfter = await page.evaluate(() => ({ ...view }))
  expect(viewAfter).toEqual({ ...fitted, y: fitted.y - 10 })
})

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('the node data follows a card as it eases into a new size', async ({ page }) => {
    await openSizedBoard(page)
    await page.locator('[data-card-size="wide"]').click()
    // The click handler reads the sizes at the start of the transition.
    await expect.poll(async () => (await boxes(page)).long).toEqual([300, 0, 520, 480])
  })
})
