const { test, expect, openBoard, textCard } = require('./helpers')

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

// A, B to its right and C below it, spanning (0, 0) to (600, 400).
const NODES = [textCard('a', 0, 0, 'A'), textCard('b', 400, 0, 'B'), textCard('c', 0, 300, 'C')]

test('an edge with explicit sides leaves and enters by those sides', async ({ page }) => {
  await openBoard(page, { nodes: NODES, edges: [{ id: 'ac', fromNode: 'a', fromSide: 'right', toNode: 'c', toSide: 'right' }] })
  // Both ends bow out to the right, by 105 units: 35% of the 300-unit gap.
  await expect(page.locator('.canvas-edge-line')).toHaveAttribute('d', 'M 200 50 C 305 50, 305 350, 200 350')
})

test('an edge draws an arrow at its target, and at its source only when asked', async ({ page }) => {
  await openBoard(page, {
    nodes: NODES,
    edges: [
      { id: 'default', fromNode: 'a', toNode: 'b' },
      { id: 'both', fromNode: 'a', toNode: 'b', fromEnd: 'arrow' },
      { id: 'none', fromNode: 'a', toNode: 'b', toEnd: 'none' },
    ],
  })
  const arrows = await page.locator('#edges > g').evaluateAll(groups => {
    return groups.map(group => {
      const polygons = [...group.querySelectorAll('polygon')]
      return polygons.map(polygon => polygon.getAttribute('points'))
    })
  })
  expect(arrows).toEqual([['400,50 387,43 387,57'], ['200,50 213,57 213,43', '400,50 387,43 387,57'], []])
})

test('an edge label sits at the midpoint of its curve', async ({ page }) => {
  await openBoard(page, { nodes: NODES, edges: [{ id: 'ab', fromNode: 'a', toNode: 'b', label: 'hello' }] })
  const label = page.locator('.canvas-edge-label')
  await expect(label).toHaveText('hello')
  await expect(label).toHaveAttribute('x', '300')
  await expect(label).toHaveAttribute('y', '50')
})

test('an edge color is a preset number or a hex value', async ({ page }) => {
  await openBoard(page, {
    nodes: NODES,
    edges: [
      { id: 'preset', fromNode: 'a', toNode: 'b', color: '1' },
      { id: 'hex', fromNode: 'a', toNode: 'c', color: '#123456' },
    ],
  })
  const colors = await page.locator('#edges > g').evaluateAll(groups => groups.map(group => group.style.getPropertyValue('--edge-color')))
  expect(colors).toEqual(['#fb464c', '#123456'])
})

test('an edge to a missing node is skipped with a warning', async ({ page }) => {
  const warnings = []
  page.on('console', message => {
    if (message.type() === 'warning') warnings.push(message.text())
  })
  await openBoard(page, {
    nodes: NODES,
    edges: [
      { id: 'missing', fromNode: 'a', toNode: 'zzz' },
      { id: 'ab', fromNode: 'a', toNode: 'b' },
    ],
  })
  await expect(page.locator('.canvas-edge-line')).toHaveCount(1)
  await expect.poll(() => warnings).toEqual([expect.stringMatching(/^edge missing references a missing node/)])
})

test('the edge layer covers the cards with a 400-unit margin', async ({ page }) => {
  await openBoard(page, { nodes: NODES })
  const layer = page.locator('#edges')
  await expect(layer).toHaveCSS('left', '-400px')
  await expect(layer).toHaveCSS('top', '-400px')
  await expect(layer).toHaveAttribute('width', '1400')
  await expect(layer).toHaveAttribute('height', '1200')
  await expect(layer).toHaveAttribute('viewBox', '-400 -400 1400 1200')
})
