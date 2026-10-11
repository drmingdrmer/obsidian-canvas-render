const { test, expect, ORIGIN, openBoard, textCard } = require('./helpers')

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
  '    code\n    more', '$$\nx\n$$', '<div>\nx\n</div>', 'a | b\n--|--',
]

const NOTE = '# A\na\n## B\nb\n### C\nc\n## D\nd\n# E\ne'

// [subpath, sliceSubpath(NOTE, subpath)]
const SLICES = [
  ['#B', '## B\nb\n### C\nc\n'],
  ['#C', '### C\nc\n'],
  ['#A', '# A\na\n## B\nb\n### C\nc\n## D\nd\n'],
  ['#E', '# E\ne'],
  ['# B ', '## B\nb\n### C\nc\n'],
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

const CODE_NOTE = '# A\nkeep\n```js\n# B\nnot a heading\n```\nstill A\n# C\nend'

// [note, subpath, sliceSubpath(note, subpath)]: a `#` line in code is no
// heading, and closing hashes and a setext underline are part of one
const PARSED_SLICES = [
  [CODE_NOTE, '#A', '# A\nkeep\n```js\n# B\nnot a heading\n```\nstill A\n'],
  [CODE_NOTE, '#B', CODE_NOTE],
  ['# A ###\na\n# C\nc', '#A', '# A ###\na\n'],
  ['A\n===\na\n# C\nc', '#A', 'A\n===\na\n'],
]

test('sliceSubpath keeps the named heading and the deeper headings under it', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const [subpath, slice] of SLICES) {
    const args = [NOTE, subpath]
    const result = await page.evaluate(([note, subpath]) => sliceSubpath(note, subpath), args)
    expect.soft(result, subpath).toBe(slice)
  }
})

test('sliceSubpath finds the headings marked parses', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const [note, subpath, slice] of PARSED_SLICES) {
    const result = await page.evaluate(([note, subpath]) => sliceSubpath(note, subpath), [note, subpath])
    expect.soft(result, `${note} ${subpath}`).toBe(slice)
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
  ['    $x$ [[Note]]', '<pre><code>$x$ [[Note]]\n</code></pre>\n'],
  ['~~~\n$x$ [[Note]]', '<pre><code>$x$ [[Note]]\n</code></pre>\n'],
  ['````\n```\n$x$\n```\n````', '<pre><code>```\n$x$\n```\n</code></pre>\n'],
  ['CANVASMATH0ENDMATH', '<p>CANVASMATH0ENDMATH</p>\n'],
  ['`CANVASMATH0ENDMATH` and $x$', '<p><code>CANVASMATH0ENDMATH</code> and [M:x]</p>\n'],
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
  ['[[Note]]', '<p><a class="internal-link" title="Note">Note</a></p>\n'],
  ['[[Note|Alias]]', '<p><a class="internal-link" title="Note">Alias</a></p>\n'],
  ['[[Note|]]', '<p><a class="internal-link" title="Note">Note</a></p>\n'],
  ['[[Note#Heading]]', '<p><a class="internal-link" title="Note#Heading">Note &gt; Heading</a></p>\n'],
  ['[[#Heading]]', '<p><a class="internal-link" title="#Heading">Heading</a></p>\n'],
  ['[[a<b]]', '<p><a class="internal-link" title="a&lt;b">a&lt;b</a></p>\n'],
  ['line1\nline2', '<p>line1<br>line2</p>\n'],
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

// Each formula KaTeX draws as HTML and MathML, an SVG among them, and a parse error.
const FORMULAS = ['$x$', '$$\\sqrt{x^2}$$', '$\\overrightarrow{AB}$', '$\\color{red}{x}$', '$bad{$']

test('markdownElement keeps KaTeX output whole', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const source of FORMULAS) {
    const result = await page.evaluate(source => {
      const html = renderMarkdown(source)
      const unsanitized = document.createElement('div')
      unsanitized.innerHTML = html
      return { sanitized: markdownElement(html, 'n.md').innerHTML, unsanitized: unsanitized.innerHTML }
    }, source)
    expect.soft(result.sanitized, source).toBe(result.unsanitized)
  }
})

test('a wikilink to a note on the board fits the view to its card', async ({ page }) => {
  const nodes = [
    { id: 'a', type: 'file', file: 'pages/a.md', x: 0, y: 0, width: 300, height: 150 },
    { id: 'b', type: 'file', file: 'pages/b.md', x: 600, y: 0, width: 200, height: 100 },
  ]
  await openBoard(page, { nodes }, { 'pages/a.md': 'See [[B]].', 'pages/b.md': 'b body' })
  await page.locator('.internal-link').click()

  // B's 200 × 100 card, centred at zoom 1 in the 1280 × 720 viewport.
  const shown = await page.evaluate(() => ({ ...view }))
  expect(shown).toEqual({ x: -60, y: 310, zoom: 1 })
  await expect(page.locator('.canvas-node').nth(1)).toHaveAttribute('data-focused', 'true')
  await expect(page).toHaveURL(`${ORIGIN}?canvas=board/board.canvas&focus=b`)
})

test('a wikilink to a note not on the board opens it on its own, looked for beside the linking document', async ({ page }) => {
  const nodes = [
    { id: 'a', type: 'file', file: 'pages/a.md', x: 0, y: 0, width: 300, height: 150 },
    textCard('t', 400, 0, '[[Top note]]'),
  ]
  const notes = { 'pages/a.md': '[[Other#Part|other]] [[#Local]]', 'pages/Other.md': 'other body [[a]]' }
  await openBoard(page, { nodes }, notes)
  const textCardLink = page.locator('.canvas-node').nth(1).locator('.internal-link')
  await expect(textCardLink).toHaveAttribute('href', '?note=board%2FTop%20note.md')
  const noteLinks = page.locator('.canvas-node').nth(0).locator('.internal-link')
  await expect(noteLinks).toHaveCount(2)
  const hrefs = await noteLinks.evaluateAll(els => els.map(el => el.getAttribute('href')))
  expect(hrefs).toEqual(['?note=board%2Fpages%2FOther.md', null])

  await noteLinks.nth(0).click()
  await expect(page).toHaveURL(`${ORIGIN}?note=board%2Fpages%2FOther.md`)
  const body = page.locator('#file-view-body')
  await expect(body).toHaveText('other body a')
  await expect(body.locator('.internal-link')).toHaveAttribute('href', '?note=board%2Fpages%2Fa.md')
})

// [link path, the id of the card linkedCard(link path) finds]
const LINKED_CARDS = [
  ['b', 'b'],
  ['B', 'b'],
  ['b.md', 'b'],
  ['pages/b', 'b'],
  ['ages/b', null],
  ['pages', null],
  ['pic.svg', 'p'],
]

test('linkedCard finds a file card by a path its file ends in, with or without .md, ignoring case', async ({ page }) => {
  const nodes = [
    textCard('t', 0, 0, 'T'),
    { id: 'b', type: 'file', file: 'pages/b.md', x: 300, y: 0, width: 200, height: 100 },
    { id: 'p', type: 'file', file: 'img/pic.svg', x: 600, y: 0, width: 200, height: 100 },
  ]
  const svg = route => route.fulfill({ body: '<svg xmlns="http://www.w3.org/2000/svg"/>', contentType: 'image/svg+xml' })
  await openBoard(page, { nodes }, { 'pages/b.md': 'b body', 'img/pic.svg': svg })
  for (const [linkPath, id] of LINKED_CARDS) {
    const found = await page.evaluate(linkPath => linkedCard(linkPath)?.id ?? null, linkPath)
    expect.soft(found, linkPath).toBe(id)
  }
})
