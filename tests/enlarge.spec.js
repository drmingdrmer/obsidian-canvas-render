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

test('a press of Space draws the focused card whole at 100% over a zoomed-out board, and the next press puts it back', async ({ page }) => {
  // Card a draws its lines while the view is fitted to it at 100%, and keeps
  // them as Fit zooms out to the whole board.
  await openBoard(page, BOARD, {}, '&cards=compact&focus=a')
  await page.locator('#zoom-fit').click()
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

  await page.keyboard.press('Space')
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

  await page.keyboard.press('Space')
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

  await page.keyboard.press('Space')
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

test('a card near the bottom-right corner of the board moves left and up only until it is as large as in Wide, and its buttons move with it', async ({ page }) => {
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

  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  const box = await card.boundingBox()
  const board = await page.locator('.canvas-wrapper').boundingBox()
  const controls = await page.locator('.canvas-controls').boundingBox()
  expect(box.width).toBeCloseTo(520, 0)
  expect(box.height).toBeCloseTo(480, 0)
  expect(box.x + box.width).toBeCloseTo(board.width - 16, 0)
  expect(box.y + box.height).toBeCloseTo(controls.y - 16, 0)
  // The enlarge button stays in the card's top-left corner, as far from it as
  // it was. In and Out stay centred on its sides, inside the 1 px border, 11 px
  // below their middle: past the 7 px half width of an edge's arrow, and 4 px
  // more.
  const buttonEnlarged = await button.boundingBox()
  expect(buttonEnlarged.x - box.x).toBeCloseTo(buttonBefore.x - before.x, 1)
  expect(buttonEnlarged.y - box.y).toBeCloseTo(buttonBefore.y - before.y, 1)
  const inBox = await card.locator('[data-direction="in"]').boundingBox()
  expect(inBox.x + inBox.width / 2).toBeCloseTo(box.x + 1, 1)
  expect(inBox.y).toBeCloseTo(box.y + box.height / 2 + 11, 1)
  const outBox = await card.locator('[data-direction="out"]').boundingBox()
  expect(outBox.x + outBox.width / 2).toBeCloseTo(box.x + box.width - 1, 1)
  expect(outBox.y).toBeCloseTo(box.y + box.height / 2 + 11, 1)

  await page.keyboard.press('Space')
  await expect(card).not.toHaveAttribute('data-enlarged')
  const after = await card.boundingBox()
  expect(after).toEqual(before)
})

test('the enlarge button shows on every card and grows with it up to 28 px, a press focuses and enlarges the card, and a second press puts it back', async ({ page }) => {
  await openBoard(page, BOARD)
  const card = page.locator('.canvas-node').first()
  const button = card.locator('.canvas-node-enlarge')
  await expect(button).toBeVisible()
  // On a board drawn at about 0.3, the button is drawn at the card's size: 28
  // units, about 8 px on screen.
  const zoom = await page.evaluate(() => view.zoom)
  const buttonBox = await button.boundingBox()
  expect(buttonBox.width).toBeCloseTo(28 * zoom, 0)

  await button.click()
  await expect(card).toHaveAttribute('data-focused', 'true')
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  // The card is drawn at 100% now, and so is the button.
  const enlargedButtonBox = await button.boundingBox()
  expect(enlargedButtonBox.width).toBeCloseTo(28, 0)
  await button.click()
  await expect(card).not.toHaveAttribute('data-enlarged')
  await expect(button).toHaveAttribute('aria-pressed', 'false')

  await button.click()
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  // The top-right corner of the viewport, clear of the cards and the controls.
  await page.mouse.click(1200, 50)
  await expect(card).not.toHaveAttribute('data-enlarged')
  await expect(card).not.toHaveAttribute('data-focused')
})

test('Enter on the enlarge button of a card without the focus puts the focus on that card and enlarges it', async ({ page }) => {
  await openBoard(page, BOARD)
  const card = page.locator('.canvas-node').first()
  // Tab can put the keyboard focus on the button as well.
  await card.locator('.canvas-node-enlarge').focus()
  await page.keyboard.press('Enter')
  await expect(card).toHaveAttribute('data-focused', 'true')
  await expect(card).toHaveAttribute('data-enlarged', 'true')
})

test('the enlarge button sits in each card\'s top-left corner, and the first line starts right of it', async ({ page }) => {
  // A file card whose title is too long for one line, a text card whose first
  // line is a header, and a text card of one line, with the text drawn at
  // twice its size. At 100%, the canvas point (550, 100) is at the centre of
  // the 1280 × 720 window, so the cards' top-left corners are at (90, 260),
  // (490, 260) and (890, 260).
  const name = 'A-title-far-too-long-for-one-line-of-the-card'
  const nodes = [
    { id: 'f', type: 'file', file: `${name}.md`, x: 0, y: 0, width: 300, height: 200 },
    textCard('h', 400, 0, 'Header\nbody'),
    textCard('o', 800, 0, 'One line'),
  ]
  await openBoard(page, { nodes }, { [`${name}.md`]: 'Text.' }, '&at=550,100,1&text=2')
  const cards = page.locator('.canvas-node')
  // Where the text of a line starts, as a float can push it right of its box.
  const textStart = el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getClientRects()[0].x
  }

  // Each button is 28 px, 4 px in from the corner inside the card's 1 px
  // border, and each first line starts 4 px right of it.
  const firstLines = ['.canvas-node-title-text', '.canvas-node-header p', '.canvas-node-content p']
  for (const [i, selector] of firstLines.entries()) {
    const card = cards.nth(i)
    const buttonLeft = 95 + 400 * i
    const button = await card.locator('.canvas-node-enlarge').boundingBox()
    expect(button).toEqual({ x: buttonLeft, y: 265, width: 28, height: 28 })
    const start = await card.locator(selector).evaluate(textStart)
    expect(start).toBeCloseTo(buttonLeft + 32, 1)
  }
})

test('a list, a quote or a rule that starts a text card starts below the enlarge button', async ({ page }) => {
  // A list's markers, a quote's bar and a rule sit left of their text, where
  // the button would cover them.
  const nodes = [textCard('l', 0, 0, '- item'), textCard('q', 300, 0, '> quote'), textCard('r', 600, 0, '***\n\ntext')]
  await openBoard(page, { nodes }, {}, '&at=400,50,1')
  const cards = page.locator('.canvas-node')
  for (const [i, selector] of ['ul', 'blockquote', 'hr'].entries()) {
    const card = cards.nth(i)
    const button = await card.locator('.canvas-node-enlarge').boundingBox()
    const block = await card.locator(selector).boundingBox()
    expect(block.y).toBeCloseTo(button.y + button.height, 1)
  }
})

test('Space on a card that shows its title alone draws what it holds', async ({ page }) => {
  await openBoard(page, BOARD)
  const card = page.locator('.canvas-node').first()
  const content = card.locator('.canvas-node-content')
  // On a board drawn at about 0.3, card a shows its header alone.
  await expect(content).toBeEmpty()
  await content.click()
  await page.keyboard.press('Space')
  await expect(content).toContainText('line 9')
})

test('a card that Space enlarged goes back when the focus moves to another card', async ({ page }) => {
  await openBoard(page, BOARD)
  const cardA = page.locator('.canvas-node').first()
  const cardB = page.locator('.canvas-node').nth(1)
  await cardA.locator('.canvas-node-content').click()
  await page.keyboard.press('Space')
  await expect(cardA).toHaveAttribute('data-enlarged', 'true')

  await cardB.click()
  await expect(cardA).not.toHaveAttribute('data-enlarged')
  await expect(cardB).toHaveAttribute('data-focused', 'true')
  await expect(cardB).not.toHaveAttribute('data-enlarged')
})

test('Space after a click on a control enlarges the card, and does not press the control again', async ({ page }) => {
  await openBoard(page, BOARD)
  const card = page.locator('.canvas-node').first()
  await card.locator('.canvas-node-content').click()
  await page.locator('#zoom-in').click()
  const zoom = await page.evaluate(() => view.zoom)

  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-enlarged', 'true')
  await page.keyboard.press('Space')
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
