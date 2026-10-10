const { test, expect } = require('@playwright/test')
const { openBoard, textCard } = require('./helpers')

test('a markdown file card links its title to the note view and its icon to the source view', async ({ page }) => {
  const card = { id: 'n', type: 'file', file: 'n.md', x: 0, y: 0, width: 300, height: 150 }
  await openBoard(page, { nodes: [card] }, { 'n.md': 'note body' })
  await expect(page.locator('.canvas-node-title-text')).toHaveText('n')

  const links = await page.locator('.canvas-node-title-link').evaluateAll(els => {
    return els.map(el => ({ href: el.getAttribute('href'), title: el.title, target: el.target }))
  })
  expect(links).toEqual([
    { href: '?note=board%2Fn.md', title: 'Read n.md', target: '_blank' },
    { href: '?raw=board%2Fn.md', title: 'View source of n.md', target: '_blank' },
  ])
})

test('an image card draws the image from the vault', async ({ page }) => {
  const card = { id: 'i', type: 'file', file: 'dir/a b.png', x: 0, y: 0, width: 300, height: 150 }
  await openBoard(page, { nodes: [card] })
  await expect(page.locator('.canvas-node-title-text')).toHaveText('a b.png')
  const image = page.locator('.canvas-node-image')
  await expect(image).toHaveAttribute('src', 'board/dir/a%20b.png')
  await expect(image).toHaveAttribute('alt', 'dir/a b.png')
})

test('a file that is neither markdown nor an image is drawn in a frame', async ({ page }) => {
  const card = { id: 'p', type: 'file', file: 'doc.pdf', x: 0, y: 0, width: 300, height: 150 }
  await openBoard(page, { nodes: [card] })
  await expect(page.locator('.canvas-node-embed')).toHaveAttribute('src', 'board/doc.pdf')
})

test('a link card frames the page and links its title to it', async ({ page }) => {
  await page.route('https://example.com/**', route => route.fulfill({ body: '<p>page</p>', contentType: 'text/html' }))
  const url = 'https://example.com/page'
  await openBoard(page, { nodes: [{ id: 'l', type: 'link', url, x: 0, y: 0, width: 300, height: 200 }] })
  await expect(page.locator('.canvas-node-title-text')).toHaveText(url)
  const links = page.locator('.canvas-node-title-link')
  await expect(links).toHaveCount(1)
  await expect(links).toHaveAttribute('href', url)

  const frame = page.locator('.canvas-node-embed')
  await expect(frame).toHaveAttribute('src', url)
  await expect(frame).toHaveAttribute('loading', 'lazy')
  await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
})

test('a group shows its label, holds no content, and is drawn behind the cards', async ({ page }) => {
  const group = { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 300, label: 'Group label' }
  await openBoard(page, { nodes: [textCard('a', 20, 40, 'A'), group] })
  const cards = page.locator('.canvas-node')
  const types = await cards.evaluateAll(els => els.map(el => el.dataset.type))
  expect(types).toEqual(['group', 'text'])
  await expect(cards.nth(0).locator('.canvas-node-label')).toHaveText('Group label')
  await expect(cards.nth(0).locator('.canvas-node-content')).toHaveCount(0)
})

test('a node of an unknown type shows a placeholder', async ({ page }) => {
  await openBoard(page, { nodes: [{ id: 'u', type: 'weird', x: 0, y: 0, width: 200, height: 100 }] })
  await expect(page.locator('.canvas-node-placeholder')).toHaveText('Unsupported node type: weird')
})

test('a card color is a preset number or a hex value', async ({ page }) => {
  const preset = { ...textCard('p', 0, 0, 'P'), color: '4' }
  const hex = { ...textCard('h', 300, 0, 'H'), color: '#123456' }
  await openBoard(page, { nodes: [preset, hex, textCard('n', 600, 0, 'N')] })
  const colors = await page.locator('.canvas-node').evaluateAll(els => {
    return els.map(el => [el.style.getPropertyValue('--node-color'), el.dataset.colored ?? null])
  })
  expect(colors).toEqual([['#44cf6e', 'true'], ['#123456', 'true'], ['', null]])

  for (const color of ['7', 'red', '', undefined]) {
    const resolved = await page.evaluate(color => resolveColor(color), color)
    expect.soft(resolved, String(color)).toBeNull()
  }
})
