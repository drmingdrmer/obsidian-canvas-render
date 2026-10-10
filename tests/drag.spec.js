const { test, expect } = require('@playwright/test')
const { openBoard, textCard, dragBy, boxes } = require('./helpers')

test('with Grid on, a dragged card lands on the 20 px grid', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody')] })
  await page.locator('#grid-snap').click()

  // A board this small opens at zoom 1, so a screen pixel is a canvas unit.
  const header = await page.locator('.canvas-node-header').boundingBox()
  const pressX = header.x + 10
  const pressY = header.y + 5
  await page.mouse.move(pressX, pressY)
  await page.mouse.down()
  await page.mouse.move(pressX + 33, pressY + 47)
  await page.mouse.up()

  const position = await page.evaluate(() => {
    const node = layout.nodes[0]
    return { x: node.x, y: node.y }
  })
  expect(position).toEqual({ x: 40, y: 40 })
})

test('a press on a text card body, or on a card without a header, moves nothing', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody'), textCard('s', 300, 0, 'single')] })
  const body = await page.locator('.canvas-node-content').first().boundingBox()
  await dragBy(page, body.x + 20, body.y + 10, 50, 50)
  const headerless = await page.locator('.canvas-node').nth(1).boundingBox()
  await dragBy(page, headerless.x + 20, headerless.y + 10, 50, 50)

  const after = await boxes(page)
  expect(after).toEqual({ a: [0, 0, 200, 100], s: [300, 0, 200, 100] })
})

test('a file card moves by the empty part of its title row, not by its title link', async ({ page }) => {
  const card = { id: 'f', type: 'file', file: 'n.md', x: 0, y: 0, width: 400, height: 150 }
  await openBoard(page, { nodes: [card] }, { 'n.md': 'note body' })

  const row = await page.locator('.canvas-node-title').boundingBox()
  await dragBy(page, row.x + row.width - 10, row.y + row.height / 2, 40, 20)
  const afterRow = await boxes(page)
  expect(afterRow).toEqual({ f: [40, 20, 400, 150] })

  const link = await page.locator('.canvas-node-title-text').boundingBox()
  await dragBy(page, link.x + 3, link.y + 3, 40, 20)
  const afterLink = await boxes(page)
  expect(afterLink).toEqual({ f: [40, 20, 400, 150] })
})

test('a group carries the cards that lie fully inside it', async ({ page }) => {
  const group = { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 300, label: 'G' }
  const inside = textCard('inside', 20, 40, 'In\nbody')
  const half = textCard('half', 400, 100, 'Half\nbody')
  const outside = textCard('outside', 600, 0, 'Out\nbody')
  await openBoard(page, { nodes: [group, inside, half, outside] })
  const frame = await page.locator('.canvas-node[data-type="group"]').boundingBox()
  await dragBy(page, frame.x + 10, frame.y + frame.height - 10, 30, 40)

  const after = await boxes(page)
  expect(after).toEqual({
    g: [30, 40, 500, 300],
    inside: [50, 80, 200, 100],
    half: [400, 100, 200, 100],
    outside: [600, 0, 200, 100],
  })
})

test('with Grid on, a dragged group lands on the grid and its cards keep their offsets', async ({ page }) => {
  const group = { id: 'g', type: 'group', x: 30, y: 40, width: 500, height: 300, label: 'G' }
  await openBoard(page, { nodes: [group, textCard('inside', 50, 80, 'In\nbody')] })
  await page.locator('#grid-snap').click()
  const frame = await page.locator('.canvas-node[data-type="group"]').boundingBox()
  await dragBy(page, frame.x + 10, frame.y + frame.height - 10, 13, 7)

  const after = await boxes(page)
  expect(after).toEqual({ g: [40, 40, 500, 300], inside: [60, 80, 200, 100] })
})

test('at zoom 0.5, a drag moves a card two units per pixel and leaves the view', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody')] })
  await page.evaluate(() => zoomAt(0, 0, 0.5))
  const viewBefore = await page.evaluate(() => ({ ...view }))
  const header = await page.locator('.canvas-node-header').boundingBox()
  await dragBy(page, header.x + 5, header.y + 5, 50, 25)

  const after = await boxes(page)
  expect(after).toEqual({ a: [100, 50, 200, 100] })
  const viewAfter = await page.evaluate(() => ({ ...view }))
  expect(viewAfter).toEqual(viewBefore)
})

test('a dragged card re-routes its edges and grows the edge layer', async ({ page }) => {
  await openBoard(page, {
    nodes: [textCard('a', 0, 0, 'A\nbody'), textCard('b', 400, 0, 'B\nbody')],
    edges: [{ id: 'ab', fromNode: 'a', toNode: 'b' }],
  })
  // The layer keeps a 400-unit margin around the cards.
  const layer = page.locator('#edges')
  await expect(layer).toHaveAttribute('height', '900')

  const header = await page.locator('.canvas-node-header').first().boundingBox()
  await dragBy(page, header.x + 5, header.y + 5, 0, 200)

  // From A's right side, now 200 units lower, to B's left side.
  await expect(page.locator('.canvas-edge-line')).toHaveAttribute('d', /^M 200 250 C .* 400 50$/)
  await expect(layer).toHaveAttribute('height', '1100')
})

test('Grid shows its state, and a reload keeps it', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const grid = page.locator('#grid-snap')
  await expect(grid).toHaveAttribute('aria-pressed', 'false')
  await grid.click()
  await expect(grid).toHaveAttribute('aria-pressed', 'true')
  const stored = await page.evaluate(() => localStorage.getItem('canvas-render-grid-snap'))
  expect(stored).toBe('true')

  await page.reload()
  await expect(grid).toHaveAttribute('aria-pressed', 'true')
  const snapToGrid = await page.evaluate(() => config.snapToGrid)
  expect(snapToGrid).toBe(true)
})
