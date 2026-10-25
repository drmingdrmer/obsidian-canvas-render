const { test, expect, openBoard, textCard } = require('./helpers')

// Two cards whose 40 lines overflow their 100-unit height, so both can scroll.
const LINES = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n\n')
const BOARD = { nodes: [textCard('a', 0, 0, `A\n${LINES}`), textCard('b', 300, 0, `B\n${LINES}`)] }

test('a click on card content focuses that card only', async ({ page }) => {
  await openBoard(page, BOARD)
  const cards = page.locator('.canvas-node')
  await cards.nth(0).locator('.canvas-node-content').click()
  await expect(cards.nth(0)).toHaveAttribute('data-focused', 'true')
  await expect(cards.nth(1)).not.toHaveAttribute('data-focused')
})

test('a wheel scrolls the focused card, and pans the board over any other card', async ({ page }) => {
  await openBoard(page, BOARD)
  const contentA = page.locator('.canvas-node-content').nth(0)
  const contentB = page.locator('.canvas-node-content').nth(1)
  await contentA.click()
  const viewBefore = await page.evaluate(() => ({ ...view }))

  // Firefox scrolls at most 90% of the 55 px content box per wheel event.
  await page.mouse.wheel(0, 40)
  await expect.poll(() => contentA.evaluate(el => el.scrollTop)).toBe(40)
  const viewAfterScroll = await page.evaluate(() => ({ ...view }))
  expect(viewAfterScroll).toEqual(viewBefore)

  await contentB.hover()
  await page.mouse.wheel(0, 40)
  await expect.poll(() => page.evaluate(() => view.y)).toBe(viewBefore.y - 40)
  const scrollTopB = await contentB.evaluate(el => el.scrollTop)
  expect(scrollTopB).toBe(0)
})

test('a click on a control keeps the focus, and a click on the background clears it', async ({ page }) => {
  await openBoard(page, BOARD)
  const cardA = page.locator('.canvas-node').nth(0)
  await cardA.locator('.canvas-node-content').click()
  await page.locator('#zoom-in').click()
  await expect(cardA).toHaveAttribute('data-focused', 'true')

  // The top-right corner of the viewport, clear of the cards and the controls.
  await page.mouse.click(1200, 50)
  await expect(cardA).not.toHaveAttribute('data-focused')
})

test('Escape takes the focus off the focused card, and puts an enlarged card back', async ({ page }) => {
  await openBoard(page, BOARD)
  const cardA = page.locator('.canvas-node').nth(0)
  await cardA.locator('.canvas-node-content').click()
  await page.keyboard.press('Space')
  await expect(cardA).toHaveAttribute('data-enlarged', 'true')

  await page.keyboard.press('Escape')
  await expect(cardA).not.toHaveAttribute('data-focused')
  await expect(cardA).not.toHaveAttribute('data-enlarged')
})

test('a press on a card header or grip moves the focus to that card', async ({ page }) => {
  await openBoard(page, BOARD)
  const cards = page.locator('.canvas-node')
  await cards.nth(0).locator('.canvas-node-content').click()

  await cards.nth(1).locator('.canvas-node-header').click()
  await expect(cards.nth(1)).toHaveAttribute('data-focused', 'true')
  await expect(cards.nth(0)).not.toHaveAttribute('data-focused')

  await cards.nth(0).locator('.canvas-node-resize').click()
  await expect(cards.nth(0)).toHaveAttribute('data-focused', 'true')
  await expect(cards.nth(1)).not.toHaveAttribute('data-focused')
})
