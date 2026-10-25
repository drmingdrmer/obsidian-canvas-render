const { test, expect, openBoard, textCard } = require('./helpers')

// A card eases into a new size over 150 ms, unless the reader asks for less
// motion; then a size read right after the change is already the final one.
test.use({ reducedMotion: 'reduce' })

// A group named Rounds, a note named def-Round, two text cards, one of which
// mentions a round, and a card so far below the rest that the board fits only
// below zoom 0.1.
const BOARD = {
  nodes: [
    { id: 'g', type: 'group', x: -40, y: -60, width: 1300, height: 300, label: 'Rounds' },
    { id: 'f', type: 'file', file: 'pages/def-Round.md', x: 0, y: 0, width: 300, height: 120 },
    textCard('t', 400, 0, 'Ballot\nA round number.'),
    textCard('q', 800, 0, 'Quorum\nAny majority.'),
    textCard('far', 0, 9000, 'Far away\nThe last round.'),
  ],
}
const NOTE = 'Each round has one leader.'
const LONG_NOTE = Array.from({ length: 40 }, (_, i) => `para ${i}`).join('\n\n')

test('the search lists the cards whose name or text holds the query, named cards first', async ({ page }) => {
  await openBoard(page, BOARD, { 'pages/def-Round.md': NOTE })
  const search = page.locator('#search')
  const entries = page.locator('#search-results > *')
  // The board fits below 10%, where a card shows its title alone. A press in
  // the search box draws every card, and a note is searched once it has loaded.
  await search.click()
  await expect(page.locator('.canvas-node[data-type="file"] .markdown-preview')).toHaveText(NOTE)

  await search.fill('round')
  await expect(entries).toHaveText(['Rounds', 'def-Round', 'Ballot', 'Far away'])
  await search.fill('LEADER')
  await expect(entries).toHaveText(['def-Round'])
  await search.fill('zzz')
  await expect(entries).toHaveText(['No card matches'])
  await expect(page.locator('.canvas-search-result')).toHaveCount(0)
  await search.fill('')
  await expect(page.locator('#search-results')).toBeHidden()
})

test('picking a result fits the view to that card and focuses it, and the zoom still goes out to the whole board', async ({ page }) => {
  await openBoard(page, BOARD, { 'pages/def-Round.md': NOTE })
  // 600 pixels inside the padding, for a board 9160 units tall.
  const boardZoom = await page.evaluate(() => view.zoom)
  expect(boardZoom).toBe(600 / 9160)
  await page.locator('#search').fill('far')
  await page.locator('.canvas-search-result').click()

  // The 200 × 100 card at (0, 9000), centred at zoom 1 in the 1280 × 720 viewport.
  const shown = await page.evaluate(() => ({ ...view }))
  expect(shown).toEqual({ x: 540, y: -8690, zoom: 1 })
  await expect(page.locator('.canvas-node', { hasText: 'Far away' })).toHaveAttribute('data-focused', 'true')
  await expect(page.locator('#search-results')).toBeHidden()

  for (let i = 0; i < 30; i += 1) await page.locator('#zoom-out').click()
  const lowest = await page.evaluate(() => view.zoom)
  expect(lowest).toBe(boardZoom)
})

test('Enter picks the first result, and Escape clears the box and leaves the focus on the card', async ({ page }) => {
  await openBoard(page, BOARD, { 'pages/def-Round.md': NOTE })
  const search = page.locator('#search')
  await search.fill('round')
  await search.press('Enter')
  await expect(page.locator('.canvas-node[data-type="group"]')).toHaveAttribute('data-focused', 'true')

  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(page.locator('#search-results')).toBeHidden()
  await expect(page.locator('.canvas-node[data-type="group"]')).toHaveAttribute('data-focused', 'true')
})

test('the view stays on a found card when the window resizes', async ({ page }) => {
  await openBoard(page, BOARD, { 'pages/def-Round.md': NOTE })
  await page.locator('#search').fill('far')
  await page.locator('#search').press('Enter')
  await page.setViewportSize({ width: 640, height: 360 })
  await expect.poll(() => page.evaluate(() => ({ ...view }))).toEqual({ x: 220, y: -8870, zoom: 1 })
})

test('a found card that grows when its note lands is fitted again', async ({ page }) => {
  let releaseNote
  const noteHeld = new Promise(resolve => {
    releaseNote = resolve
  })
  const heldNote = async route => {
    await noteHeld
    await route.fulfill({ body: LONG_NOTE })
  }
  await openBoard(page, BOARD, { 'pages/def-Round.md': heldNote }, '&cards=wide')
  await page.locator('#search').fill('def-round')
  await page.locator('#search').press('Enter')
  releaseNote()

  // Wide draws the note card 520 wide and, with the note in, 480 high.
  await expect.poll(() => page.evaluate(() => ({ ...view }))).toEqual({ x: 640 - 260, y: 360 - 240, zoom: 1 })
})

test('a wheel over a long result list scrolls the list, not the board', async ({ page }) => {
  const nodes = Array.from({ length: 30 }, (_, i) => textCard(`c${i}`, i * 300, 0, `Card ${i}`))
  await openBoard(page, { nodes })
  await page.locator('#search').fill('card')
  const results = page.locator('#search-results')
  await expect(results.locator('.canvas-search-result')).toHaveCount(30)
  const viewBefore = await page.evaluate(() => ({ ...view }))

  await results.hover()
  await page.mouse.wheel(0, 100)
  await expect.poll(() => results.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  const viewAfter = await page.evaluate(() => ({ ...view }))
  expect(viewAfter).toEqual(viewBefore)
})

test('a press outside the search closes the list and keeps the query, and a click in the box opens it again', async ({ page }) => {
  await openBoard(page, BOARD, { 'pages/def-Round.md': NOTE })
  const search = page.locator('#search')
  const results = page.locator('#search-results')
  await search.fill('round')
  await expect(results).toBeVisible()

  // The top-right corner of the viewport, clear of the cards and the controls.
  await page.mouse.click(1200, 50)
  await expect(results).toBeHidden()
  await expect(search).toHaveValue('round')
  await search.click()
  await expect(results).toBeVisible()
})
