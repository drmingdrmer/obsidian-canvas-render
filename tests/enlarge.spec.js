const { test, expect, openBoard, textCard } = require('./helpers')

// Card a holds 10 lines: more than Compact's cap of 240 units, and less than
// the room an enlarged card has in a window of 1280 × 720. Card b sits far from
// it, so the board fits at a zoom of about 0.3, where card a is too small to read.
const LINES = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n\n')
const BOARD = {
  nodes: [textCard('a', 0, 0, `A\n${LINES}`), textCard('b', 3000, 2000, 'B')],
  edges: [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
}

// A card of 400 lines, longer than any window.
const LONG_LINES = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n\n')

// What enlarging a card must leave alone: the node data, and the edge.
function boardState(page) {
  return page.locator('.canvas-wrapper').evaluate(wrapper => {
    const nodes = layout.nodes.map(node => [node.id, node.x, node.y, node.width, node.height])
    const line = wrapper.querySelector('.canvas-edge-line').getAttribute('d')
    return { nodes, line }
  })
}

// A card's box in its layer, in canvas units.
function cardBox(card) {
  return card.evaluate(el => [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight])
}

test('holding Space draws the focused card whole at 100% over a zoomed-out board, and letting go puts it back', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&cards=compact')
  const card = page.locator('.canvas-node').first()
  const content = card.locator('.canvas-node-content')
  await content.click()
  const zoom = await page.evaluate(() => view.zoom)
  expect(zoom).toBeLessThan(0.5)
  const stateBefore = await boardState(page)
  const boxBefore = await cardBox(card)
  const screenBoxBefore = await card.boundingBox()
  const clipped = await content.evaluate(el => el.scrollHeight > el.clientHeight)
  expect(clipped).toBe(true)

  await page.keyboard.down('Space')
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  // The card grows from its top-left corner, which stays where it was.
  const screenBox = await card.boundingBox()
  expect(screenBox.x).toBeCloseTo(screenBoxBefore.x, 1)
  expect(screenBox.y).toBeCloseTo(screenBoxBefore.y, 1)
  expect(screenBox.width).toBeCloseTo(520, 0)
  const hidden = await content.evaluate(el => el.scrollHeight - el.clientHeight)
  expect(hidden).toBe(0)
  const stateEnlarged = await boardState(page)
  expect(stateEnlarged).toEqual(stateBefore)

  await page.keyboard.up('Space')
  // Read at once: the card snaps back rather than easing.
  const boxAfter = await cardBox(card)
  expect(boxAfter).toEqual(boxBefore)
  await expect(card).not.toHaveAttribute('data-enlarged')
  const stateAfter = await boardState(page)
  expect(stateAfter).toEqual(stateBefore)
})

test('a long card keeps its corner while a card in Wide fits right of and below it, and grows down to the controls', async ({ page }) => {
  // At 100%, the canvas point (540, 300) is at the centre of the 1280 × 720
  // window, so card a's top-left corner is at (100, 60).
  await openBoard(page, { nodes: [textCard('a', 0, 0, `A\n${LONG_LINES}`)] }, {}, '&at=540,300,1')
  const card = page.locator('.canvas-node')
  const content = card.locator('.canvas-node-content')
  await content.click()
  const before = await card.boundingBox()
  expect(before).toEqual({ x: 100, y: 60, width: 200, height: 100 })

  await page.keyboard.down('Space')
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  const box = await card.boundingBox()
  const controls = await page.locator('.canvas-controls').boundingBox()
  expect(box.x).toBeCloseTo(100, 1)
  expect(box.y).toBeCloseTo(60, 1)
  expect(box.width).toBeCloseTo(520, 0)
  expect(box.y + box.height).toBeCloseTo(controls.y - 16, 0)
  const scrolls = await content.evaluate(el => el.scrollHeight > el.clientHeight)
  expect(scrolls).toBe(true)
})

test('a card near the bottom-right corner of the board moves left and up only until it is as large as in Wide, under a button that stays in place', async ({ page }) => {
  // At 100%, the canvas point (-360, -140) is at the centre of the 1280 × 720
  // window, so card a's top-left corner is at (1000, 500).
  await openBoard(page, { nodes: [textCard('a', 0, 0, `A\n${LONG_LINES}`)] }, {}, '&at=-360,-140,1')
  const card = page.locator('.canvas-node')
  const button = card.locator('.canvas-node-enlarge')
  const content = card.locator('.canvas-node-content')
  await content.click()
  const before = await card.boundingBox()
  expect(before).toEqual({ x: 1000, y: 500, width: 200, height: 100 })
  const buttonBefore = await button.boundingBox()

  await page.keyboard.down('Space')
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  const box = await card.boundingBox()
  const board = await page.locator('.canvas-wrapper').boundingBox()
  const controls = await page.locator('.canvas-controls').boundingBox()
  expect(box.width).toBeCloseTo(520, 0)
  expect(box.height).toBeCloseTo(480, 0)
  expect(box.x + box.width).toBeCloseTo(board.width - 16, 0)
  expect(box.y + box.height).toBeCloseTo(controls.y - 16, 0)
  const buttonEnlarged = await button.boundingBox()
  expect(buttonEnlarged.x).toBeCloseTo(buttonBefore.x, 1)
  expect(buttonEnlarged.y).toBeCloseTo(buttonBefore.y, 1)

  await page.keyboard.up('Space')
  await expect(card).not.toHaveAttribute('data-enlarged')
  const after = await card.boundingBox()
  expect(after).toEqual(before)
})

test('the enlarge button stays in place, so a second press without moving puts the card back', async ({ page }) => {
  await openBoard(page, BOARD)
  const card = page.locator('.canvas-node').first()
  const button = card.locator('.canvas-node-enlarge')
  await expect(button).toBeHidden()
  await card.locator('.canvas-node-content').click()
  await expect(button).toBeVisible()
  // The button stays 28 px on screen on a board drawn at about 0.3.
  const buttonBox = await button.boundingBox()
  expect(buttonBox.width).toBeCloseTo(28, 0)
  const x = buttonBox.x + buttonBox.width / 2
  const y = buttonBox.y + buttonBox.height / 2

  await page.mouse.click(x, y)
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  const enlargedButtonBox = await button.boundingBox()
  expect(enlargedButtonBox.x).toBeCloseTo(buttonBox.x, 1)
  expect(enlargedButtonBox.y).toBeCloseTo(buttonBox.y, 1)
  expect(enlargedButtonBox.width).toBeCloseTo(28, 0)
  await page.mouse.click(x, y)
  await expect(card).not.toHaveAttribute('data-enlarged')
  await expect(button).toHaveAttribute('aria-pressed', 'false')

  await page.mouse.click(x, y)
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  // The top-right corner of the viewport, clear of the cards and the controls.
  await page.mouse.click(1200, 50)
  await expect(card).not.toHaveAttribute('data-enlarged')
  await expect(card).not.toHaveAttribute('data-focused')
})

test('Space after a click on a control enlarges the card, and does not press the control again', async ({ page }) => {
  await openBoard(page, BOARD)
  const card = page.locator('.canvas-node').first()
  await card.locator('.canvas-node-content').click()
  await page.locator('#zoom-in').click()
  const zoom = await page.evaluate(() => view.zoom)

  await page.keyboard.down('Space')
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  await page.keyboard.up('Space')
  await expect(card).not.toHaveAttribute('data-enlarged')
  const zoomAfter = await page.evaluate(() => view.zoom)
  expect(zoomAfter).toBe(zoom)
})

test('Space in the search box types a space, and enlarges no card', async ({ page }) => {
  await openBoard(page, BOARD)
  const card = page.locator('.canvas-node').first()
  await card.locator('.canvas-node-content').click()
  const search = page.locator('#search')
  await search.click()

  await page.keyboard.type('line 1')
  await expect(search).toHaveValue('line 1')
  await expect(card).not.toHaveAttribute('data-enlarged')
})
