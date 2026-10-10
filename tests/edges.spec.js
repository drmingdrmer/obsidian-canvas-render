const { test, expect } = require('@playwright/test')
const { openBoard, textCard } = require('./helpers')

test('an edge with no sides joins the sides that face each other', async ({ page }) => {
  await openBoard(page, {
    nodes: [textCard('a', 0, 0, 'A'), textCard('b', 400, 0, 'B'), textCard('c', 0, 300, 'C')],
    edges: [
      { id: 'ab', fromNode: 'a', toNode: 'b' },
      { id: 'ac', fromNode: 'a', toNode: 'c' },
    ],
  })

  // A's right side to B's left side, and A's bottom to C's top. Both gaps are
  // 200 units, so each control point sits 70 units (35%) out from its end.
  const lines = page.locator('.canvas-edge-line')
  await expect(lines.nth(0)).toHaveAttribute('d', 'M 200 50 C 270 50, 330 50, 400 50')
  await expect(lines.nth(1)).toHaveAttribute('d', 'M 100 100 C 100 170, 100 230, 100 300')
})
