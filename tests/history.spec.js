const { test, expect, openBoard, textCard, dragBy } = require('./helpers')

// Three cards in a row. The board fits at about 0.83, with card c's right edge
// at x = 1220 and every card between y = 318 and y = 402 of the 1280 × 720
// window: clear of the history in the top-right corner.
const BOARD = {
  nodes: [textCard('a', 0, 0, 'Alpha'), textCard('b', 600, 0, 'Beta'), textCard('c', 1200, 0, 'Gamma')],
}

// Each history entry's aria-current, in list order.
function currentMarks(page) {
  return page.locator('.canvas-history-entry').evaluateAll(els => els.map(el => el.getAttribute('aria-current')))
}

test('History lists the cards the focus has been on, the latest first and each once', async ({ page }) => {
  await openBoard(page, BOARD)
  await page.locator('#history-toggle').click()
  await expect(page.locator('#history-list')).toHaveText('No card has had the focus yet')

  const cards = page.locator('.canvas-node')
  await cards.nth(0).click()
  await cards.nth(1).click()
  await cards.nth(0).click()
  const entries = page.locator('.canvas-history-entry')
  await expect(entries).toHaveText(['Alpha', 'Beta'])
  const marks = await currentMarks(page)
  expect(marks).toEqual(['true', null])

  // A press on the board takes the focus, and the mark, off every card.
  await page.mouse.click(1200, 600)
  await expect(entries).toHaveText(['Alpha', 'Beta'])
  const marksAfter = await currentMarks(page)
  expect(marksAfter).toEqual([null, null])
})

test('a click on a history entry flies the view to its card and puts the focus on it', async ({ page }) => {
  await openBoard(page, BOARD)
  await page.locator('#history-toggle').click()
  const cards = page.locator('.canvas-node')
  await cards.nth(0).click()
  await cards.nth(1).click()

  await page.locator('.canvas-history-entry', { hasText: 'Alpha' }).click()
  // Card a's 200 × 100 box, centred at zoom 1 in the 1280 × 720 viewport.
  await expect.poll(() => page.evaluate(() => ({ ...view }))).toEqual({ x: 540, y: 310, zoom: 1 })
  await expect(cards.nth(0)).toHaveAttribute('data-focused', 'true')
  await expect(page.locator('.canvas-history-entry')).toHaveText(['Alpha', 'Beta'])
})

test('the card a link opens on comes first in the history', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&focus=b')
  await page.locator('#history-toggle').click()

  await expect(page.locator('.canvas-history-entry')).toHaveText(['Beta'])
  const marks = await currentMarks(page)
  expect(marks).toEqual(['true'])
})

test('the History button shows and hides the list, and a reload keeps the choice', async ({ page }) => {
  await openBoard(page, BOARD)
  const toggle = page.locator('#history-toggle')
  const history = page.locator('#history')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(history).toBeHidden()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(history).toBeVisible()
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(history).toBeVisible()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(history).toBeHidden()
})

test('a drag or a wheel on the history leaves the focus and the view where they are', async ({ page }) => {
  await openBoard(page, BOARD)
  await page.locator('#history-toggle').click()
  const card = page.locator('.canvas-node').first()
  await card.click()
  const viewBefore = await page.evaluate(() => ({ ...view }))

  // A drag along the title, which ends over the history.
  const title = await page.locator('.canvas-history-title').boundingBox()
  await dragBy(page, title.x + 20, title.y + 10, 100, 0)
  await page.mouse.wheel(0, 100)
  // Then a wheel over the board, whose pan of 50 px shows that the wheel over
  // the history has been handled too, and moved nothing.
  await page.mouse.move(1200, 600)
  await page.mouse.wheel(0, 50)
  await expect.poll(() => page.evaluate(() => view.y)).toBe(viewBefore.y - 50)
  const viewAfter = await page.evaluate(() => ({ ...view }))
  expect(viewAfter).toEqual({ ...viewBefore, y: viewBefore.y - 50 })
  await expect(card).toHaveAttribute('data-focused', 'true')
})
