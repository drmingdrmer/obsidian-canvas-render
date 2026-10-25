const { test, expect, openBoard, textCard, dragBy } = require('./helpers')

// Card f, with dependency edges into it from b and a, which leave their right
// sides and enter its left side, and one out of it to d, which names no sides
// and so runs from f's right side to d's left, as d lies right of f. The edge
// from c, which lies above f, meets f's top side. The edge to e leaves f's
// right side but meets e's top, and the edge back from e enters f's left side
// but leaves e's bottom: none of these is a dependency edge. Card z has a
// dependency edge into a. With `focus=f`, f is fitted at zoom 1 with its
// top-left corner at (540, 310) of the 1280 × 720 window. The edge from a is
// red on the board.
const BOARD = {
  nodes: [
    textCard('f', 600, 400, 'Focus\nbody'),
    textCard('a', 0, 0, 'Alpha'),
    textCard('b', 0, 800, 'Beta'),
    textCard('c', 600, -400, 'Gamma'),
    textCard('d', 1400, 400, 'Delta'),
    textCard('z', -600, 0, 'Zeta'),
    textCard('e', 1400, 800, 'Epsilon'),
  ],
  edges: [
    { id: 'bf', fromNode: 'b', fromSide: 'right', toNode: 'f', toSide: 'left' },
    { id: 'af', fromNode: 'a', fromSide: 'right', toNode: 'f', toSide: 'left', label: 'uses', color: '1' },
    { id: 'cf', fromNode: 'c', toNode: 'f' },
    { id: 'fd', fromNode: 'f', toNode: 'd' },
    { id: 'fe', fromNode: 'f', fromSide: 'right', toNode: 'e', toSide: 'top' },
    { id: 'ef', fromNode: 'e', fromSide: 'bottom', toNode: 'f', toSide: 'left' },
    { id: 'za', fromNode: 'z', toNode: 'a' },
  ],
}

// Each preview's [left, top, width, height] in canvas units.
function previewBoxes(page) {
  return page.locator('.canvas-neighbour').evaluateAll(els => {
    return els.map(el => [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight])
  })
}

test('In previews each card with a dependency edge into the focused card, left of it', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&focus=f')
  const toggle = page.locator('.canvas-node').first().locator('[data-direction="in"]')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  await expect(page.locator('.canvas-neighbour')).toHaveText(['Beta', 'Alpha'])
  // Beta and Alpha in a column 80 units left of f, centred on the middle of its
  // left side at y = 450, with Alpha on top, as its card is higher on the board
  // than Beta's.
  const boxes = await previewBoxes(page)
  expect(boxes).toEqual([[320, 460, 200, 100], [320, 340, 200, 100]])

  // A copy of each edge leaves the preview by its side that faces f, and keeps
  // the edge's label and its arrow at f.
  const paths = await page.locator('.canvas-neighbour-link .canvas-edge-line').evaluateAll(els => {
    return els.map(el => el.getAttribute('d'))
  })
  expect(paths).toEqual(['M 520 510 C 555 510, 565 450, 600 450', 'M 520 390 C 555 390, 565 450, 600 450'])
  await expect(page.locator('.canvas-neighbour-link .canvas-edge-label')).toHaveText(['uses'])
  await expect(page.locator('.canvas-neighbour-link .canvas-edge-arrow').first()).toHaveAttribute('points', '600,450 587,443 587,457')
})

test('Out previews each card the focused card has a dependency edge to, right of it, with the arrow at the preview', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&focus=f')
  await page.locator('.canvas-node').first().locator('[data-direction="out"]').click()

  await expect(page.locator('.canvas-neighbour')).toHaveText(['Delta'])
  // 80 units right of f, centred on the middle of its right side.
  const boxes = await previewBoxes(page)
  expect(boxes).toEqual([[880, 400, 200, 100]])
  await expect(page.locator('.canvas-neighbour-link .canvas-edge-line')).toHaveAttribute('d', 'M 800 450 C 828 450, 852 450, 880 450')
  await expect(page.locator('.canvas-neighbour-link .canvas-edge-arrow')).toHaveAttribute('points', '880,450 867,443 867,457')
})

test('In sits half out of the focused card\'s left side, just below where the dependency edges enter it, and Out half out of its right side', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&focus=f')
  const card = page.locator('.canvas-node').first()
  // The arrows of the edges from b and a meet f's left side at (540, 360), and
  // spread 7 px above and below it.
  const arrow = await page.locator('.canvas-edges .canvas-edge-arrow').first().boundingBox()
  expect(arrow).toEqual({ x: 527, y: 353, width: 13, height: 14 })
  // Each button is 28 px, centred on its side inside f's 1 px border, and
  // starts 4 px below the arrows. f's right side is at x = 740.
  const inBox = await card.locator('[data-direction="in"]').boundingBox()
  expect(inBox).toEqual({ x: 527, y: 371, width: 28, height: 28 })
  const outBox = await card.locator('[data-direction="out"]').boundingBox()
  expect(outBox).toEqual({ x: 725, y: 371, width: 28, height: 28 })
})

test('In and Out show their previews together, and a second press of each removes its own', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&focus=f')
  const card = page.locator('.canvas-node').first()
  const inToggle = card.locator('[data-direction="in"]')
  const outToggle = card.locator('[data-direction="out"]')
  await inToggle.click()
  await outToggle.click()
  const previews = page.locator('.canvas-neighbour')
  await expect(previews).toHaveText(['Beta', 'Alpha', 'Delta'])

  await inToggle.click()
  await expect(inToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(previews).toHaveText(['Delta'])
  await expect(page.locator('.canvas-neighbour-link')).toHaveCount(1)

  await outToggle.click()
  await expect(outToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(previews).toHaveCount(0)
  await expect(page.locator('.canvas-neighbour-link')).toHaveCount(0)
})

test('In and Out show on the focused card alone, and its previews go when the focus leaves it', async ({ page }) => {
  await openBoard(page, BOARD)
  const cards = page.locator('.canvas-node')
  const inToggle = cards.nth(0).locator('[data-direction="in"]')
  await expect(inToggle).toBeHidden()
  await cards.nth(0).click()
  await expect(inToggle).toBeVisible()
  await inToggle.click()
  const previews = page.locator('.canvas-neighbour')
  await expect(previews).toHaveText(['Beta', 'Alpha'])

  // A preview is not a card: a press on it leaves the focus, and the previews, on f.
  await previews.first().click()
  await expect(cards.nth(0)).toHaveAttribute('data-focused', 'true')
  await expect(previews).toHaveText(['Beta', 'Alpha'])

  // The top-right corner of the viewport, clear of the cards and the previews.
  await page.mouse.click(1200, 50)
  await expect(previews).toHaveCount(0)
  await expect(page.locator('.canvas-neighbour-link')).toHaveCount(0)
  await expect(inToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(inToggle).toBeHidden()

  await cards.nth(0).click()
  await inToggle.click()
  await expect(previews).toHaveCount(2)
  await cards.nth(1).click()
  await expect(previews).toHaveCount(0)
  await expect(inToggle).toHaveAttribute('aria-pressed', 'false')
  // Card a's own In shows, and stays off.
  const otherToggle = cards.nth(1).locator('[data-direction="in"]')
  await expect(otherToggle).toBeVisible()
  await expect(otherToggle).toHaveAttribute('aria-pressed', 'false')
})

test('the button on a preview flies the view to its card, and puts the focus there', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&focus=f')
  await page.locator('.canvas-node').first().locator('[data-direction="in"]').click()
  await page.locator('.canvas-neighbour', { hasText: 'Alpha' }).locator('.canvas-neighbour-go').click()

  // Card a's 200 × 100 box, centred at zoom 1 in the 1280 × 720 viewport.
  await expect.poll(() => page.evaluate(() => ({ ...view }))).toEqual({ x: 540, y: 310, zoom: 1 })
  await expect(page.locator('.canvas-node').nth(1)).toHaveAttribute('data-focused', 'true')
  await expect(page.locator('.canvas-neighbour')).toHaveCount(0)
})

test('In and its previews are blue, and Out and its previews orange', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&focus=f')
  const card = page.locator('.canvas-node').first()
  await card.locator('[data-direction="in"]').click()
  await card.locator('[data-direction="out"]').click()

  const blue = 'rgb(37, 99, 235)'
  const orange = 'rgb(234, 88, 12)'
  const toggleColors = await card.locator('.canvas-node-neighbours').evaluateAll(els => {
    return els.map(el => getComputedStyle(el).color)
  })
  expect(toggleColors).toEqual([blue, orange])
  const frameColors = await page.locator('.canvas-neighbour').evaluateAll(els => {
    return els.map(el => getComputedStyle(el).borderTopColor)
  })
  expect(frameColors).toEqual([blue, blue, orange])
  // The copy of the red edge from a takes the colour of In too.
  const linkColors = await page.locator('.canvas-neighbour-link .canvas-edge-line').evaluateAll(els => {
    return els.map(el => getComputedStyle(el).stroke)
  })
  expect(linkColors).toEqual([blue, blue, orange])
})

test('In is greyed out on a card that no dependency edge enters, and Out on one that none leaves', async ({ page }) => {
  await openBoard(page, BOARD)
  const cards = page.locator('.canvas-node')
  // Card z has only a dependency edge out of it, and card d only one into it.
  const zDisabled = await cards.nth(5).locator('.canvas-node-neighbours').evaluateAll(els => {
    return els.map(el => el.disabled)
  })
  expect(zDisabled).toEqual([true, false])
  const dDisabled = await cards.nth(4).locator('.canvas-node-neighbours').evaluateAll(els => {
    return els.map(el => el.disabled)
  })
  expect(dDisabled).toEqual([false, true])
  // Card c's only edge, to f, is no dependency edge.
  const cDisabled = await cards.nth(3).locator('.canvas-node-neighbours').evaluateAll(els => {
    return els.map(el => el.disabled)
  })
  expect(cDisabled).toEqual([true, true])
})

test('the previews follow the card they stand around as it is dragged', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&focus=f')
  await page.locator('.canvas-node').first().locator('[data-direction="in"]').click()
  const header = await page.locator('.canvas-node').first().locator('.canvas-node-header').boundingBox()
  // The middle of the header, clear of the enlarge button in its corner.
  await dragBy(page, header.x + header.width / 2, header.y + 10, 40, 20)

  // At zoom 1, f has moved by (40, 20), and every preview with it.
  const boxes = await previewBoxes(page)
  expect(boxes).toEqual([[360, 480, 200, 100], [360, 360, 200, 100]])
})

test('the previews keep their distance from a card that a card size widens', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&focus=f')
  await page.locator('.canvas-node').first().locator('[data-direction="in"]').click()
  await page.locator('[data-card-size="compact"]').click()

  // In Compact, b is 320 units wide, so Beta's preview ends 80 units left of f
  // at x = 600.
  await expect.poll(async () => {
    const [box] = await previewBoxes(page)
    return [box[0], box[2]]
  }).toEqual([200, 320])
})

test('a card that several edges join is previewed once in each direction, and an edge to itself previews nothing', async ({ page }) => {
  const board = {
    nodes: [textCard('f', 0, 0, 'Focus'), textCard('a', 400, 0, 'Alpha')],
    edges: [
      { id: 'af', fromNode: 'a', fromSide: 'right', toNode: 'f', toSide: 'left' },
      { id: 'af-again', fromNode: 'a', fromSide: 'right', toNode: 'f', toSide: 'left', label: 'again' },
      { id: 'fa', fromNode: 'f', toNode: 'a' },
      { id: 'ff', fromNode: 'f', fromSide: 'right', toNode: 'f', toSide: 'left' },
    ],
  }
  await openBoard(page, board, {}, '&focus=f')
  const card = page.locator('.canvas-node').first()
  await card.locator('[data-direction="in"]').click()
  await card.locator('[data-direction="out"]').click()

  await expect(page.locator('.canvas-neighbour')).toHaveText(['Alpha', 'Alpha'])
  // The one for the edges in stands left of f, and the one for the edge out right of it.
  const boxes = await previewBoxes(page)
  expect(boxes).toEqual([[-280, 0, 200, 100], [280, 0, 200, 100]])
  // The first edge from a, which has no label, is the one copied.
  await expect(page.locator('.canvas-neighbour-link .canvas-edge-label')).toHaveCount(0)
})

test('an enlarged card covers the previews', async ({ page }) => {
  const board = {
    nodes: [textCard('f', 0, 0, 'Focus'), textCard('d', 400, 0, 'Delta')],
    edges: [{ id: 'fd', fromNode: 'f', toNode: 'd' }],
  }
  await openBoard(page, board, {}, '&focus=f')
  await page.locator('.canvas-node').first().locator('[data-direction="out"]').click()
  await page.keyboard.press('Space')
  await expect(page.locator('.canvas-node').first()).toHaveAttribute('data-enlarged', 'true')

  // Delta's preview spans (820, 310) to (1020, 410) on screen, and f, enlarged
  // to 520 px wide right of (540, 310), covers its left part.
  const covering = await page.evaluate(() => {
    const el = document.body.shadowRoot.elementFromPoint(900, 350)
    return el.closest('.canvas-node, .canvas-neighbour').className
  })
  expect(covering).toBe('canvas-node')
})
