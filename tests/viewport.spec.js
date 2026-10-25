const { test, expect, ORIGIN, openBoard, textCard, dragBy } = require('./helpers')

// [nodes, the view the opening fit gives in the 1280 × 720 viewport]
const FITS = [
  [[textCard('a', 0, 0, 'A')], { x: 540, y: 310, zoom: 1 }],
  [[textCard('a', 0, 0, 'A'), textCard('b', 3800, 1900, 'B')], { x: 60, y: 70, zoom: 0.29 }],
  [[], { x: 640, y: 360, zoom: 1 }],
]

// The canvas point under a screen point, in the current view.
function canvasPointAt(page, screenX, screenY) {
  return page.evaluate(([x, y]) => ({ x: (x - view.x) / view.zoom, y: (y - view.y) / view.zoom }), [screenX, screenY])
}

test('the opening fit centres the board, at zoom 1 at most', async ({ page }) => {
  for (const [nodes, fitted] of FITS) {
    await openBoard(page, { nodes })
    const result = await page.evaluate(() => ({ ...view }))
    expect.soft(result, `${nodes.length} cards`).toEqual(fitted)
  }
})

test('the fit zooms below 0.1 when the board needs it, and the zoom buttons go on from there', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A'), textCard('b', 40000, 0, 'B')] })
  // 1160 pixels inside the padding, for a board 40200 units wide.
  const fitted = 1160 / 40200
  const zoom = await page.evaluate(() => view.zoom)
  expect(zoom).toBe(fitted)
  const left = await page.locator('.canvas-node').first().boundingBox()
  const right = await page.locator('.canvas-node').last().boundingBox()
  expect(left.x).toBeCloseTo(60)
  expect(right.x + right.width).toBeCloseTo(1220)

  await page.locator('#zoom-out').click()
  const floor = await page.evaluate(() => view.zoom)
  expect(floor).toBe(fitted)
  await page.locator('#zoom-in').click()
  const zoomedIn = await page.evaluate(() => view.zoom)
  expect(zoomedIn).toBeCloseTo(fitted * 1.15)
})

test('Fit fits the board as a drag left it', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody'), textCard('b', 400, 0, 'B\nbody')] })
  const header = await page.locator('.canvas-node-header').first().boundingBox()
  // The middle of the header, clear of the enlarge button in its corner.
  await dragBy(page, header.x + header.width / 2, header.y + 5, 0, 200)
  await page.locator('#zoom-fit').click()

  const fitted = await page.evaluate(() => ({ ...view }))
  expect(fitted).toEqual({ x: 340, y: 210, zoom: 1 })
})

test('a window resize refits a view the reader has not moved, and leaves a moved one alone', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  await page.setViewportSize({ width: 640, height: 360 })
  await expect.poll(() => page.evaluate(() => ({ ...view }))).toEqual({ x: 220, y: 130, zoom: 1 })

  await page.mouse.move(100, 100)
  await page.mouse.wheel(30, 40)
  await expect.poll(() => page.evaluate(() => ({ ...view }))).toEqual({ x: 190, y: 90, zoom: 1 })
  await page.setViewportSize({ width: 1280, height: 720 })
  // Resize observers run after the frame's animation callbacks, so by the second frame they have run.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const moved = await page.evaluate(() => ({ ...view }))
  expect(moved).toEqual({ x: 190, y: 90, zoom: 1 })
})

test('a narrow window wraps the control bar, so every control stays inside the window', async ({ page }) => {
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 640 })
    await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
    const outside = await page.locator('.canvas-controls button, .canvas-controls input').evaluateAll(els => {
      const hidden = els.filter(el => {
        const box = el.getBoundingClientRect()
        const insideX = box.left >= 0 && box.right <= window.innerWidth
        const insideY = box.top >= 0 && box.bottom <= window.innerHeight
        return !(insideX && insideY)
      })
      return hidden.map(el => el.title)
    })
    expect.soft(outside, `${width} px wide`).toEqual([])
  }
})

test('the zoom buttons zoom by 1.15 around the viewport centre', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const label = page.locator('#zoom-reset')
  const centre = await canvasPointAt(page, 640, 360)
  const keepsCentre = { x: expect.closeTo(centre.x), y: expect.closeTo(centre.y) }

  await page.locator('#zoom-in').click()
  const zoomedIn = await page.evaluate(() => view.zoom)
  expect(zoomedIn).toBeCloseTo(1.15)
  await expect(label).toHaveText('115%')
  const centreIn = await canvasPointAt(page, 640, 360)
  expect(centreIn).toEqual(keepsCentre)

  await page.locator('#zoom-out').click()
  await page.locator('#zoom-out').click()
  const zoomedOut = await page.evaluate(() => view.zoom)
  expect(zoomedOut).toBeCloseTo(1 / 1.15)
  await expect(label).toHaveText('87%')
  const centreOut = await canvasPointAt(page, 640, 360)
  expect(centreOut).toEqual(keepsCentre)
})

test('the zoom stops at 3 and at 0.1, and the label resets it to 100%', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const label = page.locator('#zoom-reset')

  // 1.15 to the 10th is past 3, and 3 divided by 1.15 to the 30th is below 0.1.
  for (let i = 0; i < 10; i += 1) await page.locator('#zoom-in').click()
  const highest = await page.evaluate(() => view.zoom)
  expect(highest).toBe(3)
  await expect(label).toHaveText('300%')

  for (let i = 0; i < 30; i += 1) await page.locator('#zoom-out').click()
  const lowest = await page.evaluate(() => view.zoom)
  expect(lowest).toBe(0.1)
  await expect(label).toHaveText('10%')

  await label.click()
  const reset = await page.evaluate(() => view.zoom)
  expect(reset).toBe(1)
  await expect(label).toHaveText('100%')
})

test('the label resets the zoom to exactly 1', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  // 1.15 cubed times its inverse is 0.9999999999999999, not 1.
  for (let i = 0; i < 3; i += 1) await page.locator('#zoom-in').click()
  await page.locator('#zoom-reset').click()
  const zoom = await page.evaluate(() => view.zoom)
  expect(zoom).toBe(1)
})

test('Ctrl or Meta and the wheel zoom around the pointer', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const keepsPoint = { x: expect.closeTo(-240), y: expect.closeTo(-110) }
  await page.mouse.move(300, 200)

  // A wheel of 400 doubles or halves the zoom, so -100 multiplies it by e^0.25.
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect.poll(() => page.evaluate(() => view.zoom)).toBeCloseTo(Math.exp(0.25))
  const underCtrl = await canvasPointAt(page, 300, 200)
  expect(underCtrl).toEqual(keepsPoint)

  await page.keyboard.down('Meta')
  await page.mouse.wheel(0, 100)
  await page.keyboard.up('Meta')
  await expect.poll(() => page.evaluate(() => view.zoom)).toBeCloseTo(1)
  const underMeta = await canvasPointAt(page, 300, 200)
  expect(underMeta).toEqual(keepsPoint)
})

test('a plain wheel pans the board', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  await page.mouse.move(100, 100)
  await page.mouse.wheel(30, 40)
  await expect.poll(() => page.evaluate(() => ({ ...view }))).toEqual({ x: 510, y: 270, zoom: 1 })
})

test('a left drag pans from the background only, and a middle drag pans from anywhere', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A\nbody')] })
  await dragBy(page, 1000, 600, -100, -50)
  const afterBackground = await page.evaluate(() => ({ ...view }))
  expect(afterBackground).toEqual({ x: 440, y: 260, zoom: 1 })

  const content = await page.locator('.canvas-node-content').boundingBox()
  await dragBy(page, content.x + 20, content.y + 10, 100, 50)
  const control = await page.locator('#zoom-in').boundingBox()
  await dragBy(page, control.x + 5, control.y + 5, 100, 50)
  const afterLeftDrags = await page.evaluate(() => ({ ...view }))
  expect(afterLeftDrags).toEqual(afterBackground)

  await page.mouse.move(content.x + 20, content.y + 10)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(content.x + 120, content.y + 60)
  await page.mouse.up({ button: 'middle' })
  const afterMiddle = await page.evaluate(() => ({ ...view }))
  expect(afterMiddle).toEqual({ x: 540, y: 310, zoom: 1 })
})

test('the dot grid spacing follows the zoom', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const background = page.locator('#background')
  await expect(background).toHaveCSS('background-size', '20px 20px')
  await page.evaluate(() => zoomAt(0, 0, 0.5))
  await expect(background).toHaveCSS('background-size', '10px 10px')
})

test('a zoomed-out dot grid draws every second, fourth, … dot, never closer than 8 px', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  const background = page.locator('#background')
  // [zoom, the dot spacing drawn at it]; a board wider than a float can hold fits at zoom 0.
  const spacings = [[0.3, '12px 12px'], [0.1, '8px 8px'], [0.05, '8px 8px'], [0, '0px 0px']]
  for (const [zoom, spacing] of spacings) {
    await page.evaluate(zoom => {
      view.zoom = zoom
      applyView()
    }, zoom)
    await expect.soft(background, `zoom ${zoom}`).toHaveCSS('background-size', spacing)
  }
})

test('the dots sit on the points Grid snaps a card to', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 600, 600, 'A')] })
  await page.evaluate(() => {
    view.x = 107
    view.y = 53
    view.zoom = 1
    applyView()
  })

  // Canvas (0, 0) is now at screen (107, 53), so the grid points inside a clip
  // from (100, 40) to (140, 80) sit at clip x 7 and 27, y 13 and 33. A dot is
  // 2 px across and covers the pixel on either side of each of those lines.
  const shot = await page.screenshot({ clip: { x: 100, y: 40, width: 40, height: 40 } })
  const dark = await page.evaluate(async data => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    const columns = new Set()
    const rows = new Set()
    for (let i = 0; i < pixels.length; i += 4) {
      // The dots are #d4d5d8 on #fafafa, so a red value below 240 is a dot.
      if (pixels[i] >= 240) continue
      const pixel = i / 4
      columns.add(pixel % image.width)
      rows.add(Math.floor(pixel / image.width))
    }
    return { columns: [...columns].sort((a, b) => a - b), rows: [...rows].sort((a, b) => a - b) }
  }, shot.toString('base64'))
  expect(dark).toEqual({ columns: [6, 7, 26, 27], rows: [12, 13, 32, 33] })
})

// [at, the view it opens on in the 1280 × 720 viewport]: that canvas point at
// the centre, at that zoom held between 0.1 and 3.
const AT_VIEWS = [
  ['100,50,2', { x: 440, y: 260, zoom: 2 }],
  ['-100.5,0,1', { x: 740.5, y: 360, zoom: 1 }],
  ['0,0,10', { x: 640, y: 360, zoom: 3 }],
  ['0,0,0', { x: 640, y: 360, zoom: 0.1 }],
]

test('at opens the view on a canvas point at the centre of the viewport, at a zoom within the limits', async ({ page }) => {
  for (const [at, opened] of AT_VIEWS) {
    await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] }, {}, `&at=${at}`)
    const result = await page.evaluate(() => ({ ...view }))
    expect.soft(result, at).toEqual(opened)
  }
})

test('focus opens the view fitted to that card with the focus on it, and wins over at', async ({ page }) => {
  const nodes = [textCard('a', 0, 0, 'A'), textCard('b', 600, 0, 'B')]
  for (const query of ['&focus=b', '&at=0,0,2&focus=b']) {
    await openBoard(page, { nodes }, {}, query)
    // B's 200 × 100 card, centred at zoom 1.
    const shown = await page.evaluate(() => ({ ...view }))
    expect.soft(shown, query).toEqual({ x: -60, y: 310, zoom: 1 })
    await expect.soft(page.locator('.canvas-node').nth(1), query).toHaveAttribute('data-focused', 'true')
  }
})

test('a focus that names no card says so, and leaves the whole board in view', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] }, {}, '&focus=gone')
  await expect(page.locator('#status')).toHaveText('the focus parameter accepts the id of a card on this board, got gone')
  const result = await page.evaluate(() => ({ ...view }))
  expect(result).toEqual({ x: 540, y: 310, zoom: 1 })
  await expect(page).toHaveURL(`${ORIGIN}?canvas=board/board.canvas`)
})

test('the address bar follows the view, and keeps the other parameters as typed', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A'), textCard('b', 600, 0, 'B')] }, {}, '&vault=board/')
  const board = `${ORIGIN}?canvas=board/board.canvas&vault=board/`

  // The fit puts canvas point (400, 50) at the centre, and the wheel moves it on by (30, 40).
  await page.mouse.move(100, 100)
  await page.mouse.wheel(30, 40)
  await expect(page).toHaveURL(`${board}&at=430,90,1`)
  // A moved view keeps its corner in a smaller window, so another point is at the centre.
  await page.setViewportSize({ width: 640, height: 360 })
  await expect(page).toHaveURL(`${board}&at=110,-90,1`)
  await page.locator('#zoom-in').click()
  await expect(page).toHaveURL(`${board}&at=110,-90,1.15`)

  await page.locator('#search').fill('B')
  await page.locator('#search').press('Enter')
  await expect(page).toHaveURL(`${board}&focus=b`)
  await page.locator('#zoom-fit').click()
  await expect(page).toHaveURL(board)
})

test('a run of view changes rewrites the address bar once, after the view settles', async ({ page }) => {
  await openBoard(page, { nodes: [textCard('a', 0, 0, 'A')] })
  // Safari throws past 100 history changes in 10 seconds.
  await page.evaluate(() => {
    window.replaceStateCalls = 0
    const replaceState = history.replaceState.bind(history)
    history.replaceState = (...args) => {
      window.replaceStateCalls += 1
      replaceState(...args)
    }
    for (let i = 0; i < 200; i += 1) {
      view.x += 1
      applyView()
    }
  })
  await expect(page).toHaveURL(`${ORIGIN}?canvas=board/board.canvas&at=-100,50,1`)
  const calls = await page.evaluate(() => window.replaceStateCalls)
  expect(calls).toBe(1)
})
