const { test, expect } = require('@playwright/test')
const { openBoard, textCard } = require('./helpers')

// [text, splitTextNode(text)]
const SPLITS = [
  ['Title\nbody', { header: 'Title', body: 'body' }],
  ['Title  \n\nbody', { header: 'Title', body: '\nbody' }],
]

// splitTextNode(text) returns { header: null, body: text } for these: a first
// line that opens a block, a setext heading, a single line, a blank rest, or an
// empty first line
const NO_HEADER = [
  '# H\nbody', '- a\n- b', '1. a\nb', '> q\nb', '```\nx\n```', '| a |\n|---|', '---\nx',
  'Title\n===\nx', 'Title\n---\nx', 'Title', 'Title\n   \n', '\nbody', '',
]

const NOTE = '# A\na\n## B\nb\n### C\nc\n## D\nd\n# E\ne'

// [subpath, sliceSubpath(NOTE, subpath)]
const SLICES = [
  ['#B', '## B\nb\n### C\nc'],
  ['#C', '### C\nc'],
  ['#A', '# A\na\n## B\nb\n### C\nc\n## D\nd'],
  ['#E', '# E\ne'],
  ['# B ', '## B\nb\n### C\nc'],
  ['#Missing', NOTE],
  ['#^block1', NOTE],
  ['B', NOTE],
  ['', NOTE],
]

test('splitTextNode lifts a prose first line into the header', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const [text, split] of SPLITS) {
    const result = await page.evaluate(text => splitTextNode(text), text)
    expect.soft(result, text).toEqual(split)
  }
})

test('splitTextNode leaves a block opener, a setext heading and a lone line in the body', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const text of NO_HEADER) {
    const result = await page.evaluate(text => splitTextNode(text), text)
    expect.soft(result, text).toEqual({ header: null, body: text })
  }

  const missing = await page.evaluate(() => splitTextNode(undefined))
  expect(missing).toEqual({ header: null, body: '' })
})

test('sliceSubpath keeps the named heading and the deeper headings under it', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const [subpath, slice] of SLICES) {
    const args = [NOTE, subpath]
    const result = await page.evaluate(([note, subpath]) => sliceSubpath(note, subpath), args)
    expect.soft(result, subpath).toBe(slice)
  }
})

test('a text card draws its first line as a header strip', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('h', 0, 0, 'Head\nbody'), textCard('s', 300, 0, 'single')] })
  const cards = page.locator('.canvas-node')
  await expect(cards.nth(0).locator('.canvas-node-header')).toHaveText('Head')
  await expect(cards.nth(0).locator('.canvas-node-content')).toHaveText('body')
  await expect(cards.nth(1).locator('.canvas-node-header')).toHaveCount(0)
})

test('a file card with a subpath shows only that section of its note', async ({ page }) => {
  const card = { id: 'f', type: 'file', file: 'n.md', subpath: '#B', x: 0, y: 0, width: 300, height: 150 }
  await openBoard(page, { nodes: [card] }, { 'n.md': '# A\na text\n## B\nb text\n# C\nc text' })
  const content = page.locator('.canvas-node-content')
  await expect(content.locator('h2')).toHaveText('B')
  await expect(content).toContainText('b text')
  await expect(content).not.toContainText('a text')
  await expect(content).not.toContainText('c text')
})

test('a file card renders its note, math included', async ({ page }) => {
  const note = { id: 'n', type: 'file', file: 'n.md', x: 0, y: 0, width: 300, height: 200 }
  await openBoard(page, { nodes: [note] }, { 'n.md': 'Euler: $e^{i\\pi}+1=0$' })
  await expect(page.locator('.canvas-node-content .katex')).toHaveCount(1)
})

// [source, renderWithMarkers(source)]
const MARKDOWN = [
  ['`$x$` and $y$', '<p><code>$x$</code> and [M:y]</p>\n'],
  ['```\n[[x]] $y$\n```', '<pre><code>[[x]] $y$\n</code></pre>\n'],
  ['~~~\n$y$\n~~~', '<pre><code>$y$\n</code></pre>\n'],
  ['$a_1 * b_2$', '<p>[M:a_1 * b_2]</p>\n'],
  ['costs \\$5 and \\$10', '<p>costs $5 and $10</p>\n'],
  ['between $5 and $10', '<p>between $5 and $10</p>\n'],
  ['$bad{$', '<p>[ERR:bad{]</p>\n'],
  ['$$\nx\n$$\n---\ntext', '[D:\nx\n]\n<hr>\n<p>text</p>\n'],
  ['x\n$$\na\n$$\ny', '<p>x</p>\n[D:\na\n]\n<p>y</p>\n'],
  ['a $$x$$ b', '<p>a [D:x] b</p>\n'],
  ['---\ntitle: x\n---\nbody', '<p>body</p>\n'],
  ['---\r\ntitle: x\r\n---\r\nbody', '<p>body</p>\n'],
  ['intro\n\n---\nnot: frontmatter\n---\n', '<p>intro</p>\n<hr>\n<h2>not: frontmatter</h2>\n'],
  ['[[Note]]', '<p><a class="internal-link is-unresolved" title="Note">Note</a></p>\n'],
  ['[[Note|Alias]]', '<p><a class="internal-link is-unresolved" title="Note">Alias</a></p>\n'],
  ['[[Note|]]', '<p><a class="internal-link is-unresolved" title="Note">Note</a></p>\n'],
  ['[[Note#Heading]]', '<p><a class="internal-link is-unresolved" title="Note#Heading">Heading</a></p>\n'],
  ['[[a<b]]', '<p><a class="internal-link is-unresolved" title="a&lt;b">a&lt;b</a></p>\n'],
  ['~~gone~~', '<p><del>gone</del></p>\n'],
  ['- [ ] task\n- [x] done', '<ul>\n<li><input disabled="" type="checkbox"> task</li>\n<li><input checked="" disabled="" type="checkbox"> done</li>\n</ul>\n'],
]

// Runs in the page: the HTML renderMarkdown gives, with each formula replaced
// by a short marker so that the whole string stays readable. Display math
// becomes [D:tex], inline math [M:tex], and a formula KaTeX cannot parse
// [ERR:text].
function renderWithMarkers(source) {
  const el = document.createElement('div')
  el.innerHTML = renderMarkdown(source)
  for (const math of el.querySelectorAll('.katex-display')) {
    const tex = math.querySelector('annotation').textContent
    math.replaceWith(`[D:${tex}]`)
  }
  for (const math of el.querySelectorAll('.katex')) {
    const tex = math.querySelector('annotation').textContent
    math.replaceWith(`[M:${tex}]`)
  }
  for (const error of el.querySelectorAll('.katex-error')) {
    error.replaceWith(`[ERR:${error.textContent}]`)
  }
  return el.innerHTML
}

test('renderMarkdown keeps code literal and renders math, wikilinks and GFM', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const [source, html] of MARKDOWN) {
    const result = await page.evaluate(renderWithMarkers, source)
    expect.soft(result, source).toBe(html)
  }
})
