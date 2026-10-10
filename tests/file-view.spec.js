const { test, expect } = require('@playwright/test')
const { ORIGIN, serveApp } = require('./helpers')

const SOURCE = '---\ntag: x\n---\n# 标题\n中文 $x^2$ [[Link]]'

// Sends the note as text/markdown without a charset, as GitHub Pages and
// Python's http.server do; a browser left to itself decodes that as Latin-1.
async function serveNote(page) {
  await serveApp(page)
  const headers = { 'content-type': 'text/markdown' }
  await page.route('**/board/n.md', route => route.fulfill({ body: Buffer.from(SOURCE, 'utf8'), headers }))
}

test('?note= renders a note on a page of its own, with a link to its source', async ({ page }) => {
  await serveNote(page)
  await page.goto(`${ORIGIN}?note=board/n.md`)

  const body = page.locator('#file-view-body')
  await expect(body.locator('h1')).toHaveText('标题')
  await expect(body.locator('.katex')).toHaveCount(1)
  await expect(body).not.toContainText('tag: x')
  await expect(page).toHaveTitle('board/n.md')
  await expect(page.locator('#file-view-path')).toHaveText('board/n.md')
  const toggle = page.locator('#file-view-toggle')
  await expect(toggle).toHaveText('Source')
  await expect(toggle).toHaveAttribute('href', '?raw=board%2Fn.md')

  await expect(page.locator('body')).toHaveAttribute('data-mode', 'file')
  await expect(page.locator('#wrapper')).toBeHidden()
  await expect(page.locator('#status')).toBeHidden()
})

test('?raw= shows the source exactly, with a link back to the rendered note', async ({ page }) => {
  await serveNote(page)
  await page.goto(`${ORIGIN}?raw=board/n.md`)

  const sourceEl = page.locator('.file-view-source')
  await expect(sourceEl).toBeVisible()
  const source = await sourceEl.textContent()
  expect(source).toBe(SOURCE)
  const toggle = page.locator('#file-view-toggle')
  await expect(toggle).toHaveText('Rendered')
  await expect(toggle).toHaveAttribute('href', '?note=board%2Fn.md')
})

test('a note that cannot be read shows why', async ({ page }) => {
  await serveApp(page)
  await page.goto(`${ORIGIN}?note=board/none.md`)
  const status = page.locator('#status')
  await expect(status).toHaveText('Cannot read board/none.md (HTTP 404)')
  await expect(status).toBeVisible()
})
