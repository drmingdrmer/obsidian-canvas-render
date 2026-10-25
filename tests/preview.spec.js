const { test, expect, ORIGIN, openBoard } = require('./helpers')

// Card a's note links to card b, and card b's note links back to card a.
const BOARD = {
  nodes: [
    { id: 'a', type: 'file', file: 'pages/a.md', x: 0, y: 0, width: 300, height: 150 },
    { id: 'b', type: 'file', file: 'pages/b.md', x: 600, y: 0, width: 200, height: 100 },
  ],
}
const NOTES = { 'pages/a.md': 'See [[B]].', 'pages/b.md': 'b body [[A]]' }

// The same cards with b far below and right of a, so that a flight from one to
// the other takes about 1.4 s and zooms out to about 0.18 on the way.
const FAR_BOARD = { nodes: [BOARD.nodes[0], { ...BOARD.nodes[1], x: 6000, y: 4000 }] }

// Card b on FAR_BOARD, centred at zoom 1 in the 1280 × 720 viewport.
const FAR_B_VIEW = { x: -5460, y: -3690, zoom: 1 }

test('a click on a wikilink to a card shows the card in a preview below the link, and leaves the view alone', async ({ page }) => {
  await openBoard(page, BOARD, NOTES)
  const viewBefore = await page.evaluate(() => ({ ...view }))
  const link = page.locator('.canvas-node').first().locator('.internal-link')
  await link.click()

  await expect(page.locator('#card-preview-title')).toHaveText('b')
  await expect(page.locator('#card-preview-body')).toHaveText('b body A')
  const linkBox = await link.boundingBox()
  const box = await page.locator('#card-preview').boundingBox()
  expect(box.x).toBeCloseTo(linkBox.x, 1)
  expect(box.y).toBeCloseTo(linkBox.y + linkBox.height + 8, 1)
  expect(box.width).toBe(520)
  const viewAfter = await page.evaluate(() => ({ ...view }))
  expect(viewAfter).toEqual(viewBefore)
  await expect(page.locator('.canvas-node').nth(1)).not.toHaveAttribute('data-focused')
})

test('the preview opens above a link near the bottom of the board, where there is more room', async ({ page }) => {
  // At 100%, the canvas point (540, -140) is at the centre of the 1280 × 720
  // window, so card a's top-left corner is at (100, 500).
  await openBoard(page, BOARD, NOTES, '&at=540,-140,1')
  const link = page.locator('.canvas-node').first().locator('.internal-link')
  await link.click()

  await expect(page.locator('#card-preview-body')).toHaveText('b body A')
  const linkBox = await link.boundingBox()
  const box = await page.locator('#card-preview').boundingBox()
  expect(box.x).toBeCloseTo(linkBox.x, 1)
  expect(box.y + box.height).toBeCloseTo(linkBox.y - 8, 1)
})

test('Escape, the × button and a press outside the preview close it, and a press inside keeps it', async ({ page }) => {
  await openBoard(page, BOARD, NOTES)
  const link = page.locator('.canvas-node').first().locator('.internal-link')
  const preview = page.locator('#card-preview')

  await link.click()
  await expect(preview).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()

  await link.click()
  await page.locator('#card-preview-close').click()
  await expect(preview).toBeHidden()

  await link.click()
  await page.locator('#card-preview-title').click()
  await expect(preview).toBeVisible()
  // The top-right corner of the viewport, clear of the cards and the controls.
  await page.mouse.click(1200, 50)
  await expect(preview).toBeHidden()
})

test('Escape closes the preview alone, and a second Escape takes the focus off the card', async ({ page }) => {
  await openBoard(page, BOARD, NOTES)
  const cardA = page.locator('.canvas-node').first()
  const preview = page.locator('#card-preview')
  await cardA.locator('.internal-link').click()
  await expect(preview).toBeVisible()
  await expect(cardA).toHaveAttribute('data-focused', 'true')

  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  await expect(cardA).toHaveAttribute('data-focused', 'true')

  await page.keyboard.press('Escape')
  await expect(cardA).not.toHaveAttribute('data-focused')
})

test('a wikilink in the preview shows its own card in the same place', async ({ page }) => {
  await openBoard(page, BOARD, NOTES)
  await page.locator('.canvas-node').first().locator('.internal-link').click()
  const preview = page.locator('#card-preview')
  await expect(page.locator('#card-preview-body')).toHaveText('b body A')
  const box = await preview.boundingBox()

  await preview.locator('.internal-link').click()
  await expect(page.locator('#card-preview-title')).toHaveText('a')
  await expect(page.locator('#card-preview-body')).toHaveText('See B.')
  const boxAfter = await preview.boundingBox()
  expect(boxAfter.x).toBe(box.x)
  expect(boxAfter.y).toBe(box.y)
})

test('Go to card flies the view out and on to the card, lands on the view fitted to it, and puts the focus on it', async ({ page }) => {
  await openBoard(page, FAR_BOARD, NOTES, '&focus=a')
  await page.locator('.canvas-node').first().locator('.internal-link').click()
  await page.locator('#card-preview-go').click()
  await expect(page.locator('#card-preview')).toBeHidden()
  await expect(page.locator('.canvas-node').nth(1)).toHaveAttribute('data-focused', 'true')

  // Both ends of the flight are at zoom 1.
  await page.waitForFunction(() => view.zoom < 0.5)
  await expect.poll(() => page.evaluate(() => ({ ...view }))).toEqual(FAR_B_VIEW)
  await expect(page).toHaveURL(`${ORIGIN}?canvas=board/board.canvas&focus=b`)
})

test('a wheel during a flight stops the view where it is', async ({ page }) => {
  await openBoard(page, FAR_BOARD, NOTES, '&focus=a')
  await page.locator('.canvas-node').first().locator('.internal-link').click({ modifiers: ['Alt'] })
  await page.waitForFunction(() => view.zoom < 0.5)
  // The top-right corner of the viewport, which neither card crosses on the way.
  await page.mouse.move(1200, 50)
  await page.mouse.wheel(0, 100)

  // The address bar follows a view only after it stands still for 300 ms.
  await expect(page).toHaveURL(/&at=/)
  // The flight lands at zoom 1, and the wheel pans without zooming.
  const zoom = await page.evaluate(() => view.zoom)
  expect(zoom).toBeLessThan(0.9)
})

test('a press on the board during a flight stops the view where it is', async ({ page }) => {
  await openBoard(page, FAR_BOARD, NOTES, '&focus=a')
  await page.locator('.canvas-node').first().locator('.internal-link').click({ modifiers: ['Alt'] })
  await page.waitForFunction(() => view.zoom < 0.5)
  // The top-right corner of the viewport, which neither card crosses on the way.
  await page.mouse.move(1200, 50)
  await page.mouse.down()

  // The address bar follows a view only after it stands still for 300 ms.
  await expect(page).toHaveURL(/&at=/)
  // The flight lands at zoom 1.
  const zoom = await page.evaluate(() => view.zoom)
  expect(zoom).toBeLessThan(0.9)
  await page.mouse.up()
})

test('with reduced motion, the view jumps to the card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openBoard(page, FAR_BOARD, NOTES, '&focus=a')
  await page.locator('.canvas-node').first().locator('.internal-link').click({ modifiers: ['Alt'] })

  // Read at once: the view lands without flying.
  const shown = await page.evaluate(() => ({ ...view }))
  expect(shown).toEqual(FAR_B_VIEW)
})
