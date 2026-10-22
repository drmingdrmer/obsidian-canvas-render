const { test, expect, ORIGIN, openBoard, textCard, boxes } = require('./helpers')

// A wheel of 400 doubles or halves the spread, as it does the zoom, so -100
// multiplies it by e^0.25.
const WHEEL_FACTOR = Math.exp(0.25)

// The canvas point under a screen point, in the current view.
function canvasPointAt(page, screenX, screenY) {
  return page.evaluate(([x, y]) => ({ x: (x - view.x) / view.zoom, y: (y - view.y) / view.zoom }), [screenX, screenY])
}

// The size the body text of the first card takes on the screen.
function textSize(page) {
  return page.locator('.canvas-node-content p').first().evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const box = range.getBoundingClientRect()
    return { width: box.width, height: box.height }
  })
}

// The numbers in an edge's `d` or an arrow's `points`.
function numbers(text) {
  return text.match(/-?[\d.]+/g).map(Number)
}

test('Alt and the wheel spread the board around the pointer, and leave the text at its size', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody')] })
  const card = page.locator('.canvas-node')
  const cardBefore = await card.boundingBox()
  const textBefore = await textSize(page)
  // The opening fit puts card a at (540, 310), so the pointer is on its point (60, 40).
  await page.mouse.move(600, 350)

  await page.keyboard.down('Alt')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Alt')
  await expect.poll(() => page.evaluate(() => config.spread)).toBeCloseTo(WHEEL_FACTOR)

  // The board zooms with the spread, so the text keeps its zoom and the point stays under the pointer.
  const zoom = await page.evaluate(() => view.zoom)
  expect(zoom).toBeCloseTo(WHEEL_FACTOR)
  const underPointer = await canvasPointAt(page, 600, 350)
  expect(underPointer).toEqual({ x: expect.closeTo(60), y: expect.closeTo(40) })
  const cardAfter = await card.boundingBox()
  expect(cardAfter.width).toBeCloseTo(cardBefore.width * WHEEL_FACTOR, 1)
  expect(cardAfter.height).toBeCloseTo(cardBefore.height * WHEEL_FACTOR, 1)
  const textAfter = await textSize(page)
  expect(textAfter).toEqual({ width: expect.closeTo(textBefore.width, 1), height: expect.closeTo(textBefore.height, 1) })
  await expect(page.locator('#zoom-reset')).toHaveText('100%')
  await expect(page.locator('#spread-reset')).toHaveText('1.3×')
})

test('the spread buttons step by √2 around the centre, from 1× to 4×, and the label resets to 1×', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const label = page.locator('#spread-reset')
  const more = page.locator('#spread-more')
  const less = page.locator('#spread-less')
  await expect(label).toHaveText('1×')

  await more.click()
  await expect(label).toHaveText('1.4×')
  await more.click()
  await expect(label).toHaveText('2×')
  const spread = await page.evaluate(() => config.spread)
  expect(spread).toBeCloseTo(2)
  // The opening fit puts canvas point (100, 50) at the centre.
  const centre = await canvasPointAt(page, 640, 360)
  expect(centre).toEqual({ x: expect.closeTo(100), y: expect.closeTo(50) })
  await expect(page.locator('#zoom-reset')).toHaveText('100%')

  // Three more steps go past 4, and five back go below 1.
  for (let i = 0; i < 3; i += 1) await more.click()
  const highest = await page.evaluate(() => config.spread)
  expect(highest).toBe(4)
  await expect(label).toHaveText('4×')
  for (let i = 0; i < 5; i += 1) await less.click()
  const lowest = await page.evaluate(() => config.spread)
  expect(lowest).toBe(1)
  await expect(label).toHaveText('1×')

  await more.click()
  await label.click()
  const reset = await page.evaluate(() => config.spread)
  expect(reset).toBe(1)
  await expect(label).toHaveText('1×')
})

test('a spread moves the cards and the edges between them at once, and keeps the arrows at their size', async ({ page }) => {
  await openBoard(page, {
    nodes: [textCard('a', 0, 0, 'A'), textCard('b', 400, 0, 'B')],
    edges: [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
  })
  // Two steps of √2 make 2. The cards are read in the task that spreads them,
  // where a card still easing into its new box would show its old one.
  const cards = await page.locator('#spread-more').evaluate(el => {
    el.click()
    el.click()
    const [a, b] = el.getRootNode().querySelectorAll('.canvas-node')
    return { aRight: a.offsetLeft + a.offsetWidth, aMiddle: a.offsetTop + a.offsetHeight / 2, bLeft: b.offsetLeft }
  })
  expect(cards).toEqual({ aRight: 400, aMiddle: 100, bLeft: 800 })

  // From A's right side to B's left side, with each control point 35% of the 400-pixel gap out.
  const line = await page.locator('.canvas-edge-line').getAttribute('d')
  expect(numbers(line)).toEqual([400, 100, 540, 100, 660, 100, 800, 100].map(n => expect.closeTo(n)))
  // The arrow is 13 pixels long and 14 across, as at 1×.
  const arrow = await page.locator('.canvas-edge-arrow').getAttribute('points')
  expect(numbers(arrow)).toEqual([800, 100, 787, 93, 787, 107].map(n => expect.closeTo(n)))
})

test('a card sized by its content keeps its box in canvas units, whatever the spread', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody')] }, {}, '&cards=wide&spread=2')
  const drawn = await page.locator('.canvas-node').evaluate(el => [el.offsetWidth, el.offsetHeight])
  expect(drawn[0]).toBe(1040)
  const sized = await boxes(page)
  expect(sized).toEqual({ a: [0, 0, 520, drawn[1] / 2] })
})

test('the zoom label, its reset, Fit and the zoom limit all count the zoom of the text', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] }, {}, '&spread=2')
  const zoomLabel = page.locator('#zoom-reset')
  // The fit draws the text at 100% at most, which draws the board at 200%.
  const fitted = await page.evaluate(() => ({ ...view }))
  expect(fitted).toEqual({ x: 440, y: 260, zoom: 2 })
  await expect(zoomLabel).toHaveText('100%')
  await expect(page.locator('#spread-reset')).toHaveText('2×')

  // 1.15 to the 10th is past 3.
  for (let i = 0; i < 10; i += 1) await page.locator('#zoom-in').click()
  const highest = await page.evaluate(() => view.zoom)
  expect(highest).toBe(6)
  await expect(zoomLabel).toHaveText('300%')

  await zoomLabel.click()
  const reset = await page.evaluate(() => view.zoom)
  expect(reset).toBe(2)
  await expect(zoomLabel).toHaveText('100%')
})

test('the address bar keeps the spread, and opening that address brings the view back', async ({ page }) => {
  const nodes = [textCard('a', 0, 0, 'A'), textCard('b', 600, 0, 'B')]
  await openBoard(page, { nodes })
  const board = `${ORIGIN}?canvas=board/board.canvas`

  // The fit puts canvas point (400, 50) at the centre, and `at` gives the zoom of the text, still 1.
  await page.locator('#spread-more').click()
  await page.locator('#spread-more').click()
  await expect(page).toHaveURL(`${board}&at=400,50,1&spread=2`)

  await openBoard(page, { nodes }, {}, '&at=400,50,1&spread=2')
  const opened = await page.evaluate(() => ({ ...view }))
  expect(opened).toEqual({ x: -160, y: 260, zoom: 2 })
  await expect(page.locator('#spread-reset')).toHaveText('2×')

  await page.locator('#spread-reset').click()
  await expect(page).toHaveURL(`${board}&at=400,50,1`)
})
