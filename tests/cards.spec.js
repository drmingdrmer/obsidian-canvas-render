const { test, expect, ORIGIN, openBoard, textCard } = require('./helpers')

// 40 × 30 once decoded.
const FIGURE = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30"/></svg>'

// Runs in the page: the src and decoded size of each image, and the href of
// each link, in rendered markdown.
function readReferences(el) {
  const images = [...el.querySelectorAll('img')].map(image => {
    return { src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight }
  })
  const links = [...el.querySelectorAll('a')].map(link => link.getAttribute('href'))
  return { images, links }
}

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
  const card = { id: 'i', type: 'file', file: 'dir/a b.svg', x: 0, y: 0, width: 300, height: 150 }
  const figure = route => route.fulfill({ body: FIGURE, contentType: 'image/svg+xml' })
  await openBoard(page, { nodes: [card] }, { 'dir/a%20b.svg': figure })
  await expect(page.locator('.canvas-node-title-text')).toHaveText('a b.svg')
  const image = page.locator('.canvas-node-image')
  await expect(image).toHaveAttribute('src', 'board/dir/a%20b.svg')
  await expect(image).toHaveAttribute('alt', 'dir/a b.svg')
  await expect(image).toHaveJSProperty('naturalWidth', 40)
  await expect(image).toHaveJSProperty('naturalHeight', 30)
})

test('a file that is neither markdown nor an image is drawn in a frame', async ({ page }) => {
  const card = { id: 'p', type: 'file', file: 'doc.pdf', x: 0, y: 0, width: 300, height: 150 }
  const pdf = route => route.fulfill({ body: '%PDF-1.4', contentType: 'application/pdf' })
  await openBoard(page, { nodes: [card] }, { 'doc.pdf': pdf })
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
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox')
})

test('a link card frames and links an http or https URL only', async ({ page }) => {
  const urls = [
    'javascript:parent.scriptRan = true; void 0',
    ' JavaScript:parent.scriptRan = true; void 0',
    'data:text/html,<script>parent.scriptRan = true</script>',
  ]
  const nodes = urls.map((url, i) => ({ id: `l${i}`, type: 'link', url, x: i * 400, y: 0, width: 300, height: 200 }))
  await openBoard(page, { nodes })

  await expect(page.locator('.canvas-node-embed')).toHaveCount(0)
  await expect(page.locator('.canvas-node-title-link')).toHaveCount(0)
  const titles = await page.locator('.canvas-node-title-text').allTextContents()
  expect(titles).toEqual(urls)
  const placeholders = await page.locator('.canvas-node-placeholder').allTextContents()
  expect(placeholders).toEqual(urls.map(url => `A link card shows an http or https URL, not ${url}`))
  const scriptRan = await page.evaluate(() => window.scriptRan)
  expect(scriptRan).toBeUndefined()
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

test('a group draws its background image in the style the file names, cover by default', async ({ page }) => {
  const styles = ['cover', 'ratio', 'repeat', undefined, 'stretch']
  const nodes = styles.map((backgroundStyle, i) => {
    return { id: `g${i}`, type: 'group', x: i * 300, y: 0, width: 200, height: 100, background: 'dir/a b.svg', backgroundStyle }
  })
  const figure = route => route.fulfill({ body: FIGURE, contentType: 'image/svg+xml' })
  await openBoard(page, { nodes }, { 'dir/a%20b.svg': figure })

  const backgrounds = await page.locator('.canvas-node').evaluateAll(els => {
    return els.map(el => {
      const style = getComputedStyle(el)
      return [style.backgroundImage, style.backgroundSize, style.backgroundRepeat]
    })
  })
  const image = `url("${ORIGIN}board/dir/a%20b.svg")`
  expect(backgrounds).toEqual([
    [image, 'cover', 'no-repeat'],
    [image, 'contain', 'no-repeat'],
    [image, 'auto', 'repeat'],
    [image, 'cover', 'no-repeat'],
    [image, 'cover', 'no-repeat'],
  ])
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

test('an image or PDF card links its title to the file itself, with no source link', async ({ page }) => {
  const image = { id: 'i', type: 'file', file: 'dir/a b.svg', x: 0, y: 0, width: 300, height: 150 }
  const pdf = { id: 'p', type: 'file', file: 'doc.pdf', x: 400, y: 0, width: 300, height: 150 }
  const figure = route => route.fulfill({ body: FIGURE, contentType: 'image/svg+xml' })
  const pdfFile = route => route.fulfill({ body: '%PDF-1.4', contentType: 'application/pdf' })
  await openBoard(page, { nodes: [image, pdf] }, { 'dir/a%20b.svg': figure, 'doc.pdf': pdfFile })
  const links = await page.locator('.canvas-node-title-link').evaluateAll(els => {
    return els.map(el => ({ href: el.getAttribute('href'), title: el.title }))
  })
  expect(links).toEqual([
    { href: 'board/dir/a%20b.svg', title: 'Open dir/a b.svg' },
    { href: 'board/doc.pdf', title: 'Open doc.pdf' },
  ])
})

test('a file extension is read from the file name, not from a folder name', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const extensions = await page.evaluate(() => ['dir.v1/file', 'dir.v1/Note.MD', 'file'].map(fileExtension))
  expect(extensions).toEqual(['', 'md', ''])
})

test('markdown finds its images and links beside the note or canvas it is written in', async ({ page }) => {
  const note = '![figure](../assets/figure.svg)\n[next](next.md) [top](#top) [web](https://example.com/)'
  const figure = route => route.fulfill({ body: FIGURE, contentType: 'image/svg+xml' })
  const card = { id: 'n', type: 'file', file: 'pages/n.md', x: 0, y: 0, width: 300, height: 200 }
  const text = textCard('t', 400, 0, '![figure](assets/figure.svg)')
  await openBoard(page, { nodes: [card, text] }, { 'pages/n.md': note, 'assets/figure.svg': figure })

  const figureUrl = `${ORIGIN}board/assets/figure.svg`
  const decoded = { src: figureUrl, width: 40, height: 30 }
  const noteReferences = { images: [decoded], links: [`${ORIGIN}board/pages/next.md`, '#top', 'https://example.com/'] }
  const cards = page.locator('.canvas-node')
  const notePreview = cards.nth(0).locator('.markdown-preview')
  const textPreview = cards.nth(1).locator('.markdown-preview')
  await expect(notePreview.locator('img')).toHaveJSProperty('complete', true)
  await expect(textPreview.locator('img')).toHaveJSProperty('complete', true)
  expect(await notePreview.evaluate(readReferences)).toEqual(noteReferences)
  expect(await textPreview.evaluate(readReferences)).toEqual({ images: [decoded], links: [] })

  await page.goto(`${ORIGIN}?note=board/pages/n.md`)
  const filePreview = page.locator('#file-view-body .markdown-preview')
  await expect(filePreview.locator('img')).toHaveJSProperty('complete', true)
  expect(await filePreview.evaluate(readReferences)).toEqual(noteReferences)
})
