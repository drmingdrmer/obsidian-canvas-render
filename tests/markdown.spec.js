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

// [source, renderWithMarkers(source)]
const MARKDOWN = [
  ['`$x$` and $y$', '<p><code>$x$</code> and [M:y]</p>\n'],
  ['```\n[[x]] $y$\n```', '<pre><code>[[x]] $y$\n</code></pre>\n'],
  ['~~~\n$y$\n~~~', '<pre><code>$y$\n</code></pre>\n'],
  ['$a_1 * b_2$', '<p>[M:a_1 * b_2]</p>\n'],
  ['costs \\$5 and \\$10', '<p>costs $5 and $10</p>\n'],
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
