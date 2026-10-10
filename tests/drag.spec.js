const { test, expect } = require('@playwright/test')
const { openBoard, textCard } = require('./helpers')

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
