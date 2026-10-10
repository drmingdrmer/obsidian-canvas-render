const { test, expect } = require('@playwright/test')
const { openBoard, textCard, dragBy, boxes } = require('./helpers')

// A card eases into a new size over 150 ms, unless the reader asks for less
// motion; then a size read right after the change is already the final one.
test.use({ reducedMotion: 'reduce' })

test('the resize grip shows only while the pointer is on its card', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody')] })
  const grip = page.locator('.canvas-node-resize')
  await expect(grip).toHaveCSS('opacity', '0')
  await page.locator('.canvas-node').hover()
  await expect(grip).toHaveCSS('opacity', '0.75')
})

test('dragging the grip resizes the card, re-routes its edges and focuses it', async ({ page }) => {
  await openBoard(page, {
    nodes: [textCard('a', 10, 10, 'A\nbody'), textCard('b', 400, 10, 'B\nbody')],
    edges: [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
  })
  const card = page.locator('.canvas-node').first()
  const grip = await card.locator('.canvas-node-resize').boundingBox()
  await dragBy(page, grip.x + 8, grip.y + 8, 100, 50)

  const after = await boxes(page)
  expect(after).toEqual({ a: [10, 10, 300, 150], b: [400, 10, 200, 100] })
  // From the middle of A's right side, which is now 75 units down.
  await expect(page.locator('.canvas-edge-line')).toHaveAttribute('d', /^M 310 85 C /)
  await expect(card).toHaveAttribute('data-focused', 'true')
})

test('a card resized smaller stops at 120 × 60', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 10, 10, 'A\nbody')] })
  const grip = await page.locator('.canvas-node-resize').boundingBox()
  await dragBy(page, grip.x + 8, grip.y + 8, -300, -300)

  const after = await boxes(page)
  expect(after).toEqual({ a: [10, 10, 120, 60] })
})

test('with Grid on, the dragged corner of a card lands on the grid', async ({ page }) => {
  const card = { ...textCard('a', 10, 10, 'A\nbody'), width: 120, height: 60 }
  await openBoard(page, { nodes: [card] })
  await page.locator('#grid-snap').click()
  const grip = await page.locator('.canvas-node-resize').boundingBox()
  await dragBy(page, grip.x + 8, grip.y + 8, 113, 57)

  // The corner goes from (243, 127) to (240, 120); the origin stays off the grid.
  const after = await boxes(page)
  expect(after).toEqual({ a: [10, 10, 230, 110] })
})

test('a card resized in Compact keeps its size until Compact is pressed again', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody'), textCard('b', 600, 0, 'B\nbody')] })
  const compact = page.locator('[data-card-size="compact"]')
  await compact.click()
  const card = page.locator('.canvas-node').first()
  await expect(card).toHaveAttribute('data-sized', 'content')
  const compactBoxes = await boxes(page)
  const [x, y, width, height] = compactBoxes.a
  expect(width).toBe(320)

  const grip = await card.locator('.canvas-node-resize').boundingBox()
  await dragBy(page, grip.x + 8, grip.y + 8, 100, 50)
  await expect(card).not.toHaveAttribute('data-sized')
  const resized = await boxes(page)
  expect(resized.a).toEqual([x, y, width + 100, height + 50])

  await compact.click()
  await expect(card).toHaveAttribute('data-sized', 'content')
  const restored = await boxes(page)
  expect(restored).toEqual(compactBoxes)
})
