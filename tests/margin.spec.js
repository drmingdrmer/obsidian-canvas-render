const { test, expect, openBoard, textCard } = require('./helpers')

// A flight lands at once, so the titles are drawn for its end alone.
test.use({ reducedMotion: 'reduce' })

// With `at=0,0,1`, the 1280 × 720 window shows the board at zoom 1, with the
// canvas origin at its centre. Inside the margin, 32 px wide, the view holds x
// from -608 to 608 and y from -328 to 328 of the canvas. Cards f, g and v lie
// in view, and the others out of it. Card r lies 20 px into the window, but in
// the margin, so it counts as out of view too. The edges from f to r and to s
// run along y = 0, and leave the view at its right side, at the middle of the
// window. The green edge from t comes down x = 0 into f's top side, and the
// edge from v runs up x = 400 to u: both leave the view at its top side. The
// edge from g joins f to a card in view.
const BOARD = {
  nodes: [
    textCard('f', -100, -50, 'Focus'),
    textCard('g', -500, 100, 'Near'),
    textCard('v', 300, -300, 'View'),
    textCard('r', 620, -50, 'Right'),
    textCard('s', 1100, -50, 'Second'),
    textCard('t', -100, -600, 'Top'),
    textCard('u', 300, -800, 'Up'),
    textCard('z', -100, -1200, 'Zenith'),
  ],
  edges: [
    { id: 'fr', fromNode: 'f', fromSide: 'right', toNode: 'r', toSide: 'left' },
    { id: 'fs', fromNode: 'f', fromSide: 'right', toNode: 's', toSide: 'left' },
    { id: 'tf', fromNode: 't', fromSide: 'bottom', toNode: 'f', toSide: 'top', color: '4' },
    { id: 'gf', fromNode: 'g', toNode: 'f' },
    { id: 'vu', fromNode: 'v', fromSide: 'top', toNode: 'u', toSide: 'bottom' },
    { id: 'tz', fromNode: 't', toNode: 'z' },
  ],
}

// The box of the title that names a card, in whole pixels of the window, with
// the middle of its width as `centre`.
async function titleBox(page, name) {
  const box = await page.locator('.canvas-margin-title', { hasText: name }).boundingBox()
  const left = Math.round(box.x)
  const right = Math.round(box.x + box.width)
  const centre = Math.round(box.x + box.width / 2)
  return { left, right, centre, top: Math.round(box.y), bottom: Math.round(box.y + box.height) }
}

test('each card out of view that an edge joins to the focused card shows its title where the edge leaves the view', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&at=0,0,1')
  await page.locator('.canvas-node').nth(0).click()
  const titles = page.locator('.canvas-margin-title')
  await expect(titles).toHaveText(['Right', 'Second', 'Top'])
  const sides = await titles.evaluateAll(els => els.map(el => el.dataset.side))
  expect(sides).toEqual(['right', 'right', 'top'])

  // Right stands 4 px from the right edge, centred on y = 360. Second would
  // take the same place, so it stands below Right, 4 px apart.
  const right = await titleBox(page, 'Right')
  expect(right.right).toBe(1276)
  expect(right.top).toBe(348)
  expect(right.bottom).toBe(372)
  const second = await titleBox(page, 'Second')
  expect(second.right).toBe(1276)
  expect(second.top).toBe(376)

  // Top stands 4 px from the top edge, centred on x = 640.
  const top = await titleBox(page, 'Top')
  expect(top.centre).toBe(640)
  expect(top.top).toBe(4)

  // The arrow takes the colour of the edge: green for the edge from t, and the
  // default grey for the others.
  const arrowColors = await titles.evaluateAll(els => els.map(el => getComputedStyle(el, '::before').color))
  const grey = 'rgb(122, 122, 122)'
  expect(arrowColors).toEqual([grey, grey, 'rgb(68, 207, 110)'])
})

test('titles show for the focused card alone, and only while it is in view', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&at=0,0,1')
  const cards = page.locator('.canvas-node')
  const titles = page.locator('.canvas-margin-title')
  await cards.nth(0).click()
  await expect(titles).toHaveText(['Right', 'Second', 'Top'])

  // Card v's one edge leads to u, out of view.
  await cards.nth(2).click()
  await expect(titles).toHaveText(['Up'])

  // A press on the board takes the focus, and every title, away.
  await page.mouse.click(1100, 600)
  await expect(titles).toHaveCount(0)

  // 400 px further down, the focused card f is out of view, and so are its titles.
  await cards.nth(0).click()
  await expect(titles).toHaveText(['Right', 'Second', 'Top'])
  await page.evaluate(() => {
    view.y += 400
    applyView()
  })
  await expect(titles).toHaveCount(0)
})

test('titles keep clear of the controls and the history', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&at=0,0,1')
  const cards = page.locator('.canvas-node')
  const titles = page.locator('.canvas-margin-title')

  // Up stands 4 px from the top edge, centred on x = 1040, until the history
  // covers x = 1024 to 1264 at the top. Then it stands left of the history.
  await cards.nth(2).click()
  await expect(titles).toHaveText(['Up'])
  const up = await titleBox(page, 'Up')
  expect(up.centre).toBe(1040)
  expect(up.top).toBe(4)
  await page.locator('#history-toggle').click()
  const history = await page.locator('.canvas-history').boundingBox()
  await expect.poll(async () => (await titleBox(page, 'Up')).right).toBe(history.x - 4)

  // 400 px further down, t is in view. Its edge to f leaves the view at the
  // bottom, at x = 640, which the controls cover, so Focus stands right of them.
  await page.evaluate(() => {
    view.y += 400
    applyView()
  })
  await cards.nth(5).click()
  await expect(titles).toHaveText(['Focus', 'Zenith'])
  const controls = await page.locator('.canvas-controls').boundingBox()
  const focus = await titleBox(page, 'Focus')
  expect(focus.left).toBe(Math.round(controls.x + controls.width + 4))
  expect(focus.bottom).toBe(716)
  const zenith = await titleBox(page, 'Zenith')
  expect(zenith.centre).toBe(640)
  expect(zenith.top).toBe(4)

  // Larger text widens its label, from 1× to 1.1×, and so the controls. Focus
  // moves right with them.
  await page.locator('#text-larger').click()
  const widerControls = await page.locator('.canvas-controls').boundingBox()
  expect(widerControls.width).toBeGreaterThan(controls.width)
  const clearOfWider = Math.round(widerControls.x + widerControls.width + 4)
  await expect.poll(async () => (await titleBox(page, 'Focus')).left).toBe(clearOfWider)
})

test('a click on a title flies the view to its card, and puts the focus on it', async ({ page }) => {
  await openBoard(page, BOARD, {}, '&at=0,0,1')
  await page.locator('.canvas-node').nth(0).click()
  const titles = page.locator('.canvas-margin-title')
  await expect(titles).toHaveText(['Right', 'Second', 'Top'])

  // A reader's press lasts a frame or more. It leaves the focus on f until the
  // click, so the title under it stays.
  const box = await titles.filter({ hasText: 'Right' }).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.mouse.up()

  // Card r's 200 × 100 box, centred at zoom 1 in the 1280 × 720 window.
  await expect.poll(() => page.evaluate(() => ({ ...view }))).toEqual({ x: -80, y: 360, zoom: 1 })
  await expect(page.locator('.canvas-node').nth(3)).toHaveAttribute('data-focused', 'true')

  // Now f lies 20 px into the window, in the margin on the left, so it counts
  // as out of view, and r's edge to it leaves the view there.
  await expect(titles).toHaveText(['Focus'])
  const focus = await titleBox(page, 'Focus')
  expect(focus.left).toBe(4)
  expect(focus.top).toBe(348)
})

// Card w lies in view with `at=0,0,1` by its bottom-left corner alone, which
// shows in the window's top-right corner. Its top side, where its edge to x
// starts, lies 92 px beyond the top of the view and 52 px beyond its right
// side, and the edge runs up out of view all the way.
const CORNER_BOARD = {
  nodes: [textCard('w', 560, -420, 'Corner'), textCard('x', 560, -900, 'Beyond')],
  edges: [{ id: 'wx', fromNode: 'w', fromSide: 'top', toNode: 'x', toSide: 'bottom' }],
}

test('an edge out of view all the way has its title on the side that its start lies farthest beyond', async ({ page }) => {
  await openBoard(page, CORNER_BOARD, {}, '&at=0,0,1')
  // A press on w's corner, at (590, -340) on the canvas.
  await page.mouse.click(1230, 20)
  const titles = page.locator('.canvas-margin-title')
  await expect(titles).toHaveText(['Beyond'])
  await expect(titles).toHaveAttribute('data-side', 'top')

  // The title stands as near the start as it fits: at the right end of the top side.
  const beyond = await titleBox(page, 'Beyond')
  expect(beyond.right).toBe(1276)
  expect(beyond.top).toBe(4)
})
