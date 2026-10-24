const { test, expect, ORIGIN, openBoard, textCard, boxes } = require('./helpers')

// The wheel scales the text as it scales the zoom, by e^(-deltaY / 400), so a
// wheel of -100 multiplies it by e^0.25.
const WHEEL_FACTOR = Math.exp(0.25)

// The font size of each kind of text on the board, and the width of the halo
// around an edge label, in CSS pixels.
function textSizes(page) {
  return page.locator('.canvas-wrapper').evaluate(wrapper => {
    const sizeOf = (selector, property) => parseFloat(getComputedStyle(wrapper.querySelector(selector))[property])
    return {
      title: sizeOf('.canvas-node-title', 'fontSize'),
      header: sizeOf('.canvas-node-header', 'fontSize'),
      content: sizeOf('.canvas-node-content', 'fontSize'),
      groupLabel: sizeOf('.canvas-node-label', 'fontSize'),
      edgeLabel: sizeOf('.canvas-edge-label', 'fontSize'),
      edgeLabelHalo: sizeOf('.canvas-edge-label', 'strokeWidth'),
    }
  })
}

// Everything the text size leaves alone: the view, the box of each card, and
// the line and the arrow of each edge.
function layoutState(page) {
  return page.locator('.canvas-wrapper').evaluate(wrapper => {
    const cardEls = [...wrapper.querySelectorAll('.canvas-node')]
    const cards = cardEls.map(el => [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight])
    const lines = [...wrapper.querySelectorAll('.canvas-edge-line')].map(el => el.getAttribute('d'))
    const arrows = [...wrapper.querySelectorAll('.canvas-edge-arrow')].map(el => el.getAttribute('points'))
    return { view: { ...view }, cards, lines, arrows }
  })
}

// The numbers in an edge's `d`.
function numbers(text) {
  return text.match(/-?[\d.]+/g).map(Number)
}

test('the text buttons resize every text on the board, and leave the cards, the edges and the view as they were', async ({ page }) => {
  const nodes = [
    { id: 'g', type: 'group', x: -40, y: -80, width: 680, height: 260, label: 'G' },
    textCard('a', 0, 0, 'A\nbody'),
    { id: 'n', type: 'file', file: 'n.md', x: 400, y: 0, width: 200, height: 100 },
  ]
  await openBoard(page, { nodes, edges: [{ id: 'an', fromNode: 'a', toNode: 'n', label: 'to n' }] }, { 'n.md': 'note body' })
  await expect(page.getByText('note body')).toBeVisible()
  const layoutBefore = await layoutState(page)
  const sizesBefore = await textSizes(page)
  expect(sizesBefore).toEqual({ title: 16, header: 16, content: 15, groupLabel: 15, edgeLabel: 13, edgeLabelHalo: 5 })

  // Seven steps make 2.
  for (let i = 0; i < 7; i += 1) {
    await page.locator('#text-larger').click()
  }
  await expect(page.locator('#text-reset')).toHaveText('2×')
  const sizesLarger = await textSizes(page)
  expect(sizesLarger).toEqual({ title: 32, header: 32, content: 30, groupLabel: 30, edgeLabel: 26, edgeLabelHalo: 10 })
  const layoutLarger = await layoutState(page)
  expect(layoutLarger).toEqual(layoutBefore)
  await expect(page.locator('#zoom-reset')).toHaveText('100%')

  for (let i = 0; i < 8; i += 1) {
    await page.locator('#text-smaller').click()
  }
  await expect(page.locator('#text-reset')).toHaveText('0.91×')
  const layoutSmaller = await layoutState(page)
  expect(layoutSmaller).toEqual(layoutBefore)
})

test('the text buttons step by about 10%, from 0.25× to 4×, and the label resets to 1×', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const label = page.locator('#text-reset')
  const larger = page.locator('#text-larger')
  const smaller = page.locator('#text-smaller')
  await expect(label).toHaveText('1×')

  // Fourteen steps reach 4, and a fifteenth stays there.
  const raised = []
  for (let i = 0; i < 15; i += 1) {
    await larger.click()
    raised.push(await label.textContent())
  }
  expect(raised).toEqual(['1.1×', '1.2×', '1.3×', '1.5×', '1.6×', '1.8×', '2×', '2.2×', '2.4×', '2.7×', '3×', '3.3×', '3.6×', '4×', '4×'])
  const highest = await page.evaluate(() => config.textScale)
  expect(highest).toBe(4)

  // Twenty-eight steps reach 0.25, passing 1 on the way, and a twenty-ninth
  // stays there.
  const lowered = []
  for (let i = 0; i < 29; i += 1) {
    await smaller.click()
    lowered.push(await label.textContent())
  }
  expect(lowered).toEqual([
    '3.6×', '3.3×', '3×', '2.7×', '2.4×', '2.2×', '2×', '1.8×', '1.6×', '1.5×', '1.3×', '1.2×', '1.1×', '1×',
    '0.91×', '0.82×', '0.74×', '0.67×', '0.61×', '0.55×', '0.5×', '0.45×', '0.41×', '0.37×', '0.34×', '0.3×', '0.28×', '0.25×', '0.25×',
  ])
  const lowest = await page.evaluate(() => config.textScale)
  expect(lowest).toBe(0.25)

  await label.click()
  const reset = await page.evaluate(() => config.textScale)
  expect(reset).toBe(1)
  await expect(label).toHaveText('1×')
})

test('Alt and the wheel make the text larger, and leave the view and the cards as they were', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody')] })
  const before = await layoutState(page)
  await page.mouse.move(600, 350)

  await page.keyboard.down('Alt')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Alt')
  await expect.poll(() => page.evaluate(() => config.textScale)).toBeCloseTo(WHEEL_FACTOR)

  const after = await layoutState(page)
  expect(after).toEqual(before)
  await expect(page.locator('#text-reset')).toHaveText('1.3×')
  await expect(page.locator('#zoom-reset')).toHaveText('100%')
})

test('a card that Wide sizes by its content grows with its text, and its edge follows', async ({ page }) => {
  const canvas = {
    nodes: [textCard('a', 0, 0, 'A\nbody'), textCard('b', 0, 400, 'B')],
    edges: [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
  }
  await openBoard(page, canvas, {}, '&cards=wide')
  const card = page.locator('.canvas-node').first()
  const heightBefore = await card.evaluate(el => el.offsetHeight)

  for (let i = 0; i < 7; i += 1) {
    await page.locator('#text-larger').click()
  }
  const heightAfter = await card.evaluate(el => el.offsetHeight)
  expect(heightAfter).toBeGreaterThan(heightBefore)
  await expect.poll(async () => (await boxes(page)).a).toEqual([0, 0, 520, heightAfter])

  // The edge leaves from the middle of the card's new bottom side.
  const line = await page.locator('.canvas-edge-line').getAttribute('d')
  const start = numbers(line).slice(0, 2)
  expect(start).toEqual([260, heightAfter])
})

test('the address bar keeps the text size, and opening that address brings it back', async ({ page }) => {
  const nodes = [textCard('a', 0, 0, 'A'), textCard('b', 600, 0, 'B')]
  await openBoard(page, { nodes })
  const board = `${ORIGIN}?canvas=board/board.canvas`
  const fitted = await page.evaluate(() => ({ ...view }))

  // The view is still the one fitted to the whole board, so the address names no `at`.
  for (let i = 0; i < 7; i += 1) {
    await page.locator('#text-larger').click()
  }
  await expect(page).toHaveURL(`${board}&text=2`)

  await openBoard(page, { nodes }, {}, '&text=2')
  const opened = await page.evaluate(() => ({ ...view }))
  expect(opened).toEqual(fitted)
  await expect(page.locator('#text-reset')).toHaveText('2×')
  const contentSize = await page.locator('.canvas-node-content').first().evaluate(el => getComputedStyle(el).fontSize)
  expect(contentSize).toBe('30px')

  await page.locator('#text-reset').click()
  await expect(page).toHaveURL(board)
})
