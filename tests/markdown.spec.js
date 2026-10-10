const { test, expect } = require('@playwright/test')
const { openBoard, textCard } = require('./helpers')

test('splitTextNode lifts a prose first line into the header', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const split = await page.evaluate(() => splitTextNode('Title\nbody'))
  expect(split).toEqual({ header: 'Title', body: 'body' })
})

test('a file card renders its note, math included', async ({ page }) => {
  const note = { id: 'n', type: 'file', file: 'n.md', x: 0, y: 0, width: 300, height: 200 }
  await openBoard(page, { nodes: [note] }, { 'n.md': 'Euler: $e^{i\\pi}+1=0$' })
  await expect(page.locator('.canvas-node-content .katex')).toHaveCount(1)
})
