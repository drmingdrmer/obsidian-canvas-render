const { test, expect, ORIGIN, serveApp, openBoard, textCard } = require('./helpers')

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
  'http://[',
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

// [query, resolveAttachments(new URLSearchParams(query))]
const ATTACHMENT_FOLDERS = [
  ['', null],
  ['attachments=assets', 'assets/'],
  ['attachments=assets/', 'assets/'],
  ['attachments=', ''],
]

function refusal(parameter, path) {
  return `the ${parameter} parameter accepts a same-origin path or an https URL on raw.githubusercontent.com, got ${path}`
}

// [query, the message #status shows for it]
const REFUSED_QUERIES = [
  ['canvas=https://evil.example/x.canvas', refusal('canvas', 'https://evil.example/x.canvas')],
  ['raw=https://evil.example/n.md', refusal('raw', 'https://evil.example/n.md')],
  ['canvas=board/board.canvas&vault=https://evil.example/', refusal('vault', 'https://evil.example/')],
  ['canvas=board/board.canvas&vault=&attachments=https://evil.example/', refusal('attachments', 'https://evil.example/')],
  ['note=board/n.md&vault=&attachments=https://evil.example/', refusal('attachments', 'https://evil.example/')],
  ['cards=huge', 'the cards parameter accepts actual, wide, compact, got huge'],
  ['cards=toString', 'the cards parameter accepts actual, wide, compact, got toString'],
  ['cards=constructor', 'the cards parameter accepts actual, wide, compact, got constructor'],
  ['cards=__proto__', 'the cards parameter accepts actual, wide, compact, got __proto__'],
  ['at=1,2', 'the at parameter accepts <x>,<y>,<zoom>, got 1,2'],
  ['at=1,2,-3', 'the at parameter accepts <x>,<y>,<zoom>, got 1,2,-3'],
  ['at=,,1', 'the at parameter accepts <x>,<y>,<zoom>, got ,,1'],
  ['spread=5', 'the spread parameter accepts a number from 1 to 4, got 5'],
  ['spread=x', 'the spread parameter accepts a number from 1 to 4, got x'],
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

test('resolveAttachments ends a folder with a slash, and is null with no parameter', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  for (const [query, folder] of ATTACHMENT_FOLDERS) {
    const result = await page.evaluate(query => resolveAttachments(new URLSearchParams(query)), query)
    expect.soft(result, query).toBe(folder)
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

test('a file card refuses a file on another host and requests nothing from it', async ({ page }) => {
  const requested = []
  await page.route('**://evil.example/**', route => {
    requested.push(route.request().url())
    return route.fulfill({ body: 'evil' })
  })
  // Under an empty vault root, the path a file node stores is the whole URL.
  const files = ['https://evil.example/n.md', '//evil.example/p.pdf', 'https://evil.example/i.png']
  const nodes = files.map((file, i) => ({ id: `f${i}`, type: 'file', file, x: i * 400, y: 0, width: 300, height: 200 }))
  await openBoard(page, { nodes }, {}, '&vault=')

  await expect(page.locator('.canvas-node-title-link')).toHaveCount(0)
  const placeholders = await page.locator('.canvas-node-placeholder').allTextContents()
  expect(placeholders).toEqual(files.map(file => `A file card loads a same-origin path or an https URL on raw.githubusercontent.com, not ${file}`))
  expect(requested).toEqual([])
})

test('a group refuses a background on another host and requests nothing from it', async ({ page }) => {
  const requested = []
  await page.route('**://evil.example/**', route => {
    requested.push(route.request().url())
    return route.fulfill({ body: 'evil' })
  })
  const warnings = []
  page.on('console', message => {
    if (message.type() === 'warning') warnings.push(message.text())
  })
  const group = { id: 'g', type: 'group', x: 0, y: 0, width: 300, height: 200, background: 'https://evil.example/i.png' }
  await openBoard(page, { nodes: [group] }, {}, '&vault=')

  await expect(page.locator('.canvas-node')).toHaveCSS('background-image', 'none')
  expect(warnings).toEqual(['group g: a background loads from a same-origin path or an https URL on raw.githubusercontent.com, not https://evil.example/i.png'])
  expect(requested).toEqual([])
})
