const { test, expect } = require('@playwright/test')
const { ORIGIN, serveApp, openBoard, textCard } = require('./helpers')

// assertAllowedHost(path, 'canvas') passes for these
const ALLOWED = [
  'board/x.canvas',
  '/abs/x.canvas',
  'http://canvas.test/x',
  'https://raw.githubusercontent.com/x',
  'HTTPS://RAW.GITHUBUSERCONTENT.COM/x',
]

// and throws refusal('canvas', path) for these
const REFUSED = [
  '//evil.example/x',
  'http://raw.githubusercontent.com/x',
  'https://raw.githubusercontent.com.evil.example/x',
  'https://evil.example/x',
  'javascript:alert(1)',
  'data:text/plain,x',
  'blob:http://canvas.test/x',
]

// [path, encodePath(path)]
const ENCODED = [
  ['pages/a #b.md', 'pages/a%20%23b.md'],
  ['https://raw.githubusercontent.com/u/r/x y.md', 'https://raw.githubusercontent.com/u/r/x%20y.md'],
  ['中文/页.md', '%E4%B8%AD%E6%96%87/%E9%A1%B5.md'],
  ['a?b.md', 'a%3Fb.md'],
]

// [query, canvas path, resolveVaultRoot(new URLSearchParams(query), canvas path)]
const VAULT_ROOTS = [
  ['', 'vault/demo.canvas', 'vault/'],
  ['', 'a.canvas', ''],
  ['', 'https://raw.githubusercontent.com/u/r/main/b/x.canvas', 'https://raw.githubusercontent.com/u/r/main/b/'],
  ['vault=notes', 'x/y.canvas', 'notes/'],
  ['vault=notes/', 'x/y.canvas', 'notes/'],
  ['vault=', 'x/y.canvas', ''],
]

function refusal(parameter, path) {
  return `the ${parameter} parameter accepts a same-origin path or an https URL on raw.githubusercontent.com, got ${path}`
}

// [query, the message #status shows for it]
const REFUSED_QUERIES = [
  ['canvas=https://evil.example/x.canvas', refusal('canvas', 'https://evil.example/x.canvas')],
  ['raw=https://evil.example/n.md', refusal('raw', 'https://evil.example/n.md')],
  ['canvas=board/board.canvas&vault=https://evil.example/', refusal('vault', 'https://evil.example/')],
  ['cards=huge', 'the cards parameter accepts actual, wide, compact, got huge'],
  ['cards=toString', 'the cards parameter accepts actual, wide, compact, got toString'],
  ['cards=constructor', 'the cards parameter accepts actual, wide, compact, got constructor'],
  ['cards=__proto__', 'the cards parameter accepts actual, wide, compact, got __proto__'],
]

// Runs in the page: 'ok' when the canvas parameter may hold the path, or else
// the message assertAllowedHost throws.
function checkCanvasHost(path) {
  try {
    assertAllowedHost(path, 'canvas')
    return 'ok'
  } catch (error) {
    return error.message
  }
}

test('assertAllowedHost passes a same-origin path and an https URL on raw.githubusercontent.com', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const path of ALLOWED) {
    const result = await page.evaluate(checkCanvasHost, path)
    expect.soft(result, path).toBe('ok')
  }
})

test('assertAllowedHost refuses every other host and scheme', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const path of REFUSED) {
    const result = await page.evaluate(checkCanvasHost, path)
    expect.soft(result, path).toBe(refusal('canvas', path))
  }
})

test('encodePath encodes each segment and keeps the scheme and host', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const [path, encoded] of ENCODED) {
    const result = await page.evaluate(path => encodePath(path), path)
    expect.soft(result, path).toBe(encoded)
  }
})

test('resolveVaultRoot defaults to the canvas directory and ends a root with a slash', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const [query, canvasPath, root] of VAULT_ROOTS) {
    const args = [query, canvasPath]
    const result = await page.evaluate(([query, canvasPath]) => resolveVaultRoot(new URLSearchParams(query), canvasPath), args)
    expect.soft(result, `${query} ${canvasPath}`).toBe(root)
  }
})

test('resolveVaultRoot refuses a vault on another host', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const message = await page.evaluate(() => {
    try {
      return resolveVaultRoot(new URLSearchParams('vault=https://evil.example/'), 'x.canvas')
    } catch (error) {
      return error.message
    }
  })
  expect(message).toBe(refusal('vault', 'https://evil.example/'))
})

test('preferredCardSize takes the cards parameter over the stored size', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const sizes = await page.evaluate(() => {
    const fromParameter = preferredCardSize(new URLSearchParams('cards=wide'))
    localStorage.setItem(CARD_SIZE_STORAGE_KEY, 'compact')
    const parameterOverStored = preferredCardSize(new URLSearchParams('cards=actual'))
    const stored = preferredCardSize(new URLSearchParams(''))
    localStorage.setItem(CARD_SIZE_STORAGE_KEY, 'bogus')
    const storedUnknown = preferredCardSize(new URLSearchParams(''))
    localStorage.setItem(CARD_SIZE_STORAGE_KEY, 'toString')
    const storedInherited = preferredCardSize(new URLSearchParams(''))
    return { fromParameter, parameterOverStored, stored, storedUnknown, storedInherited }
  })
  expect(sizes).toEqual({ fromParameter: 'wide', parameterOverStored: 'actual', stored: 'compact', storedUnknown: 'actual', storedInherited: 'actual' })

  const message = await page.evaluate(() => {
    try {
      return preferredCardSize(new URLSearchParams('cards=huge'))
    } catch (error) {
      return error.message
    }
  })
  expect(message).toBe('the cards parameter accepts actual, wide, compact, got huge')
})

test('a refused parameter shows its message and draws no card', async ({ page }) => {
  await serveApp(page)
  for (const [query, message] of REFUSED_QUERIES) {
    await page.goto(`${ORIGIN}?${query}`)
    await expect.soft(page.locator('#status'), query).toHaveText(message)
    await expect.soft(page.locator('.canvas-node'), query).toHaveCount(0)
  }
})
