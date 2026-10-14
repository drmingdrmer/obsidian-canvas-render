const { test, expect, ORIGIN, serveApp, openBoard, textCard } = require('./helpers')

test.use({ colorScheme: 'dark' })

test('under a dark OS the page opens dark, with ☀ on both toggles', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark')
  const glyphs = await page.locator('.theme-toggle').allTextContents()
  expect(glyphs).toEqual(['☀', '☀'])
})

test('a toggle flips the theme, and a reload keeps the choice', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  await page.locator('.canvas-controls .theme-toggle').click()
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'light')
  const glyphs = await page.locator('.theme-toggle').allTextContents()
  expect(glyphs).toEqual(['☾', '☾'])
  const stored = await page.evaluate(() => localStorage.getItem('canvas-render-theme'))
  expect(stored).toBe('light')

  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'light')
})

test('the file view toggle flips the theme too', async ({ page }) => {
  await serveApp(page)
  await page.route('**/board/n.md', route => route.fulfill({ body: 'note body' }))
  await page.goto(`${ORIGIN}?note=board/n.md`)
  await page.locator('.file-view-theme').click()
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'light')
})

test('the theme follows the OS until a toggle is pressed', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark')

  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'light')
  const stored = await page.evaluate(() => localStorage.getItem('canvas-render-theme'))
  expect(stored).toBeNull()
})
