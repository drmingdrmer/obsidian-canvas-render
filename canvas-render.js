/**
 * Renders a JSON Canvas file (https://jsoncanvas.org) the way Obsidian draws it:
 * nodes are absolutely positioned DOM elements, edges are one SVG layer beneath
 * them, and the whole thing sits in a pan/zoom viewport over a dot grid.
 *
 * An ES module: `mount` draws the board inside an element of any page.
 */

import {
  SIDE_NORMALS, sideAnchor, inferSide, edgeGeometry, bezierPoint, arrowPoints, contentBounds,
  viewSpan, flightPath, easeInOut, meetsRect, sideBeyond, lastExit, freeStretches, nearestFit,
} from './src/geometry.js'
import { encodePath, fetchFile, createResources } from './src/resources.js'
import { SVG_NAMESPACE, createElements, createIcon, placeholderElement } from './src/elements.js'
import { createMarkdown } from './src/markdown.js'
import { resolveColor, nodeTitleText, holdsEmbed, createCardRenderer } from './src/cards.js'

// ---------------------------------------------------------------- constants

/** The folder this module is served from, which holds its stylesheets and the renderer's own page. */
const APP_URL = new URL('./', import.meta.url)

const KATEX_STYLESHEET = 'lib/katex/katex.min.css'

/** The stylesheets a board's shadow root links, relative to this module; the board's own come last, to win. */
const BOARD_STYLESHEETS = [KATEX_STYLESHEET, 'canvas-render.css']

/**
 * The libraries the board calls, as the global each one's script defines and
 * the script's path relative to this module. A page that has loaded one
 * already lends it to the board.
 */
const LIBRARIES = [
  ['marked', 'lib/marked.min.js'],
  ['katex', 'lib/katex/katex.min.js'],
  ['DOMPurify', 'lib/purify.min.js'],
]

const DEFAULT_CANVAS_PATH = 'vault/demo.canvas'
const THEME_STORAGE_KEY = 'canvas-render-theme'
const CARD_SIZE_STORAGE_KEY = 'canvas-render-card-size'
const GRID_SNAP_STORAGE_KEY = 'canvas-render-grid-snap'
const HISTORY_STORAGE_KEY = 'canvas-render-history'

/**
 * What the card-size control offers, one button each. `actual` draws every card
 * at the size its file gives it. The other two ignore that size, fix one width
 * for the whole board and let the content set the height, up to a cap that
 * keeps a long note from towering over the rest.
 */
const CARD_SIZES = {
  actual: { width: null, maxHeight: null },
  wide: { width: 520, maxHeight: 480 },
  compact: { width: 320, maxHeight: 240 },
}

const CARD_SIZE_NAMES = Object.keys(CARD_SIZES)

/**
 * Hosts besides this page's own origin that a canvas, a vault, a note or a file
 * card may be loaded from. Rendered markdown is stripped of script, but
 * everything else in it — text, images, links, forms — appears as this page's
 * own content, so extending the list is a trust decision.
 */
const REMOTE_HOSTS = ['raw.githubusercontent.com']

const GRID_SIZE = 20
/** The closest two background dots are drawn, in screen pixels; each dot is 2 px across. */
const MIN_DOT_SPACING = 8
const MIN_CARD_WIDTH = 120
const MIN_CARD_HEIGHT = 60
const MIN_ZOOM = 0.1
const MAX_ZOOM = 3
const ZOOM_STEP = 1.15
const FIT_PADDING = 60
const FIT_MAX_ZOOM = 1

/**
 * The text size draws the text on the board from MIN_TEXT_SCALE to
 * MAX_TEXT_SCALE times its own size, in cards of the same size. A text button
 * multiplies it by TEXT_SCALE_STEP, about 1.1. Seven steps double the text, so
 * from 1 the buttons reach either end in 14 steps and come back to 1 from it.
 */
const MIN_TEXT_SCALE = 0.25
const MAX_TEXT_SCALE = 4
const TEXT_SCALE_STEP = 2 ** (1 / 7)

/**
 * A card draws what it holds once it is in view on a board drawn at
 * CONTENT_MIN_ZOOM or more. Below that its text is too small to read, so a
 * board zoomed out to fit shows each card's title alone, and loads no note.
 * Text drawn larger than its own size makes up for a smaller zoom.
 */
const CONTENT_MIN_ZOOM = 0.5

/**
 * An enlarged card is at least as large as the same card in Wide: when the
 * room right of or below its corner is smaller, the card moves left or up.
 * It stays ENLARGED_MARGIN clear of the board's edges and of the controls.
 */
const ENLARGED_MIN_SIZE = CARD_SIZES.wide
const ENLARGED_MARGIN = 16

/**
 * A card preview is as wide as a card in Wide, and at most as tall. It opens
 * PREVIEW_GAP below the link that names the card, or above it when there is
 * more room there, and stays PREVIEW_GAP clear of the board's edges.
 */
const PREVIEW_SIZE = CARD_SIZES.wide
const PREVIEW_GAP = 8

/**
 * In and Out preview a card's neighbours around it, each cut to the size of a
 * card in Compact at most. The previews stand NEIGHBOUR_DISTANCE clear of the
 * card, which leaves room for the edges between them, and NEIGHBOUR_GAP clear
 * of each other.
 */
const NEIGHBOUR_SIZE = CARD_SIZES.compact
const NEIGHBOUR_DISTANCE = 80
const NEIGHBOUR_GAP = 20

/**
 * A card out of view that an edge joins to the focused card shows its title in
 * the margin, a band MARGIN_TITLE_BAND wide along each side of the viewport.
 * A title is MARGIN_TITLE_HEIGHT tall and at most MARGIN_TITLE_MAX_WIDTH wide.
 * It stands MARGIN_TITLE_INSET clear of the viewport's edge, and
 * MARGIN_TITLE_GAP clear of the other titles and of the controls.
 */
const MARGIN_TITLE_HEIGHT = 24
const MARGIN_TITLE_MAX_WIDTH = 200
const MARGIN_TITLE_INSET = 4
const MARGIN_TITLE_GAP = 4
const MARGIN_TITLE_BAND = MARGIN_TITLE_HEIGHT + MARGIN_TITLE_INSET * 2

/**
 * A move to another card flies the view there on the path van Wijk and Nuij
 * give in "Smooth and efficient zooming and panning": it zooms out as it pans,
 * and back in as it lands, so that the way between the two cards stays in
 * sight. Each unit of the path's length takes FLIGHT_MS_PER_UNIT, and a flight
 * lasts from FLIGHT_MIN_MS to FLIGHT_MAX_MS.
 */
const FLIGHT_MS_PER_UNIT = 400
const FLIGHT_MIN_MS = 500
const FLIGHT_MAX_MS = 1500

/** How many cards the History list keeps, unless the `history` parameter names another number. */
const DEFAULT_HISTORY_LENGTH = 100

/** Wheel delta that doubles the zoom, divided by ln 2. Larger means gentler. */
const ZOOM_WHEEL_SENSITIVITY = 400

/**
 * How long the view has to stay put, in milliseconds, before the address bar
 * follows it. Following every frame of a pan would run into Safari's limit of
 * 100 history changes in 10 seconds, past which `replaceState` throws.
 */
const VIEW_URL_DELAY = 300

/** Extra room around the node bounding box so bowed edges are not clipped. */
const EDGE_LAYER_MARGIN = 400

const OPPOSITE_SIDES = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }

// ------------------------------------------------------------------ elements

const {
  boardFragment, wrapperEl, backgroundEl, canvasEl, edgesEl, neighboursEl, neighbourLinksEl, marginEl, statusEl,
  controlsEl, zoomInEl, zoomOutEl, zoomResetEl, zoomFitEl, textSmallerEl, textResetEl, textLargerEl, cardSizeEls,
  gridSnapEl, historyToggleEl, historyEl, historyListEl, searchEl, searchResultsEl, themeToggleEls, fileViewEl,
  fileViewBackEl, fileViewPathEl, fileViewToggleEl, fileViewBodyEl, cardPreviewEl, cardPreviewTitleEl,
  cardPreviewGoEl, cardPreviewCloseEl, cardPreviewBodyEl,
} = createElements()

// --------------------------------------------------------------------- state

/** The element `mount` drew the board in, null until then; it carries the theme and the view mode. */
let hostEl = null

/** Screen position of canvas origin, plus the current scale factor. */
const view = { x: 0, y: 0, zoom: 1 }

/**
 * The view as `fitToContent` last left it, and the node it fitted, null for the
 * whole board; a pan or a zoom by the reader makes it stale.
 */
let fittedView = null

/** The zoom controls stop at 10%, or lower when the last fit needed less to show the whole board. */
let zoomFloor = MIN_ZOOM

/**
 * Read from the parameters at startup; the card size, the grid and the text
 * size follow their controls. `ownsPage` is false for a board mounted in
 * another page, which leaves that page's address and title alone. `textScale`
 * is how many times its own size the text on the board is drawn, 1 by default.
 */
const config = {
  canvasPath: '',
  vaultRoot: '',
  attachments: null,
  cardSize: 'actual',
  snapToGrid: false,
  textScale: 1,
  historyLength: DEFAULT_HISTORY_LENGTH,
  ownsPage: true,
}

/**
 * The drawn canvas: node data, the element each node was drawn as, the edges on
 * it, and the sizes the file authored — which the node data no longer holds
 * once a card is drawn at a size of its own.
 */
const layout = { nodes: [], elements: new Map(), edgesByNode: new Map(), authoredSizes: new Map() }

/** The paths and links of the board's files, as `main` sets `config` up for them. */
const resources = createResources(config, APP_URL, REMOTE_HOSTS)
const { noteHref, rawHref, assertAllowedHost, resolveVaultRoot, resolveAttachments } = resources

/** The board's markdown, which `main` starts once marked, KaTeX and DOMPurify have loaded. */
const markdown = createMarkdown(resources, {
  linkedCard, showCardPreview, closeCardPreview, closeFileView, flyToCard, showOnPlainClick, openFile,
})
const { startMarkdown, renderMarkdown, markdownElement } = markdown

/** What the board draws in a card, and in the card preview. */
const { fillFileNode, fillNodeElement, fillNodeContent } =
  createCardRenderer(config, REMOTE_HOSTS, resources, markdown, { showOnPlainClick, openFile })

// --------------------------------------------------------------------- theme

function preferredTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored) return stored

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  if (prefersDark) return 'dark'
  return 'light'
}

function applyTheme(theme) {
  hostEl.dataset.theme = theme
  const glyph = theme === 'dark' ? '☀' : '☾'
  for (const toggleEl of themeToggleEls) toggleEl.textContent = glyph
}

/** Every view carries a toggle, so the wiring cannot live with the canvas controls. */
function installThemeToggles() {
  applyTheme(preferredTheme())
  for (const toggleEl of themeToggleEls) {
    toggleEl.addEventListener('click', () => {
      const isDark = hostEl.dataset.theme === 'dark'
      const theme = isDark ? 'light' : 'dark'
      applyTheme(theme)
      // Only a choice is stored: until the reader makes one, each load follows the OS.
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    })
  }
}

// ------------------------------------------------------------- node contents

/**
 * The file card a wikilink names: one whose path ends in the link's path, with
 * or without `.md`, ignoring case — the way Obsidian finds a note by its name
 * alone. Null when no card on the board holds it.
 */
function linkedCard(linkPath) {
  const wantedPaths = [linkPath, `${linkPath}.md`].map(path => `/${path.toLowerCase()}`)
  const isLinked = node => {
    if (node.type !== 'file') return false
    const file = `/${node.file.toLowerCase()}`
    return wantedPaths.some(wantedPath => file.endsWith(wantedPath))
  }
  return layout.nodes.find(isLinked) ?? null
}

// -------------------------------------------------------------- node element

function createNodeElement(node) {
  const el = document.createElement('div')
  el.className = 'canvas-node'
  el.dataset.type = node.type
  el.style.left = `${node.x}px`
  el.style.top = `${node.y}px`
  applyNodeSize(el, node)
  fillNodeElement(el, node)
  return el
}

/** The cards on the board that have not drawn what they hold yet. */
const unfilledNodes = new Set()

/**
 * Draws what each card in view holds, while the board is drawn large enough to
 * read it: see CONTENT_MIN_ZOOM. A card keeps what it has drawn.
 */
function fillCardsInView() {
  if (unfilledNodes.size === 0) return
  const zoom = view.zoom * Math.max(config.textScale, 1)
  if (zoom < CONTENT_MIN_ZOOM) return

  const boardRect = wrapperEl.getBoundingClientRect()
  const rect = viewRect(boardRect.width, boardRect.height)
  for (const node of unfilledNodes) {
    if (meetsRect(node, rect)) fillCard(node)
  }
}

/** The id of the frame that draws the cards in view, or 0 while none is due. */
let fillFrame = 0

/**
 * Draws the cards in view on the next frame, once however many changes ask for
 * it. A card drawn inside `cardSizeObserver`'s callback, where a refit moves the
 * view, would change size there, and the observer reports that as a loop error.
 */
function scheduleFillCards() {
  if (fillFrame !== 0) return
  fillFrame = requestAnimationFrame(() => {
    fillFrame = 0
    fillCardsInView()
  })
}

/** Draws what a card on the board holds, unless it has already. */
function fillCard(node) {
  const unfilled = unfilledNodes.delete(node)
  if (!unfilled) return
  fillNodeContent(layout.elements.get(node.id), node)
}

// -------------------------------------------------------------- edge element

function createEdgeArrow() {
  const arrow = document.createElementNS(SVG_NAMESPACE, 'polygon')
  arrow.setAttribute('class', 'canvas-edge-arrow')
  return arrow
}

/**
 * Builds the group and its children with no coordinates in them, and returns
 * the record `layoutEdge` writes those into. Holding on to the child elements
 * is what spares a moved node a DOM query per pointer move.
 */
function createEdgeElements(edge, fromNode, toNode) {
  const group = document.createElementNS(SVG_NAMESPACE, 'g')
  const color = resolveColor(edge.color)
  if (color) group.style.setProperty('--edge-color', color)

  const path = document.createElementNS(SVG_NAMESPACE, 'path')
  path.setAttribute('class', 'canvas-edge-line')
  group.appendChild(path)

  // Spec default: no arrow at the source, an arrow at the target.
  const startArrow = edge.fromEnd === 'arrow' ? createEdgeArrow() : null
  const endArrow = edge.toEnd === 'none' ? null : createEdgeArrow()
  if (startArrow) group.appendChild(startArrow)
  if (endArrow) group.appendChild(endArrow)

  let label = null
  if (edge.label) {
    label = document.createElementNS(SVG_NAMESPACE, 'text')
    label.setAttribute('class', 'canvas-edge-label')
    label.textContent = edge.label
    group.appendChild(label)
  }

  return { group, edge, fromNode, toNode, path, startArrow, endArrow, label }
}

/** The sides an edge leaves and enters its cards by, where the board draws it. */
function edgeSides(record) {
  const { edge, fromNode, toNode } = record
  const fromSide = edge.fromSide || inferSide(fromNode, toNode)
  const toSide = edge.toSide || inferSide(toNode, fromNode)
  return { fromSide, toSide }
}

/** Writes the geometry the endpoints' current positions imply into an existing edge. */
function layoutEdge(record) {
  const { fromNode, toNode } = record
  const { fromSide, toSide } = edgeSides(record)
  const geometry = edgeGeometry(fromNode, fromSide, toNode, toSide)

  const { start, startControl, endControl, end } = geometry
  record.path.setAttribute(
    'd',
    `M ${start.x} ${start.y} C ${startControl.x} ${startControl.y}, ${endControl.x} ${endControl.y}, ${end.x} ${end.y}`,
  )

  if (record.startArrow) {
    record.startArrow.setAttribute('points', arrowPoints(start, geometry.startNormal))
  }
  if (record.endArrow) {
    record.endArrow.setAttribute('points', arrowPoints(end, geometry.endNormal))
  }

  if (!record.label) return
  const midpoint = bezierPoint(geometry, 0.5)
  record.label.setAttribute('x', midpoint.x)
  record.label.setAttribute('y', midpoint.y)
}

// ------------------------------------------------------------------ viewport

let shownZoomLabel = ''

function applyView() {
  canvasEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
  // How large a card is drawn on screen, which a card's enlarge button undoes to keep one size.
  canvasEl.style.setProperty('--zoom', view.zoom)

  // Dots closer than MIN_DOT_SPACING run together into a flat grey, so a
  // zoomed-out board draws every second, fourth, … dot instead.
  let spacing = GRID_SIZE * view.zoom
  while (spacing > 0 && spacing < MIN_DOT_SPACING) spacing *= 2
  backgroundEl.style.backgroundSize = `${spacing}px ${spacing}px`
  // A dot sits at the centre of its tile, so the tiles start half a tile before
  // the points Grid snaps to.
  const tileX = view.x % spacing - spacing / 2
  const tileY = view.y % spacing - spacing / 2
  backgroundEl.style.backgroundPosition = `${tileX}px ${tileY}px`

  scheduleViewUrl()
  placeEnlargedCard()
  scheduleMarginTitles()
  scheduleFillCards()

  const zoomLabel = `${Math.round(view.zoom * 100)}%`
  if (zoomLabel === shownZoomLabel) return
  shownZoomLabel = zoomLabel
  zoomResetEl.textContent = zoomLabel
}

function zoomAt(screenX, screenY, nextZoom) {
  const clamped = Math.min(MAX_ZOOM, Math.max(zoomFloor, nextZoom))
  const canvasX = (screenX - view.x) / view.zoom
  const canvasY = (screenY - view.y) / view.zoom

  view.zoom = clamped
  view.x = screenX - canvasX * clamped
  view.y = screenY - canvasY * clamped
  applyView()
}

function zoomAroundCentre(nextZoom) {
  const rect = wrapperEl.getBoundingClientRect()
  zoomAt(rect.width / 2, rect.height / 2, nextZoom)
}

/** Draws the text on the board `textScale` times its own size, and shows that in its label. */
function applyTextScale(textScale) {
  config.textScale = textScale
  canvasEl.style.setProperty('--text-scale', textScale)
  const shown = Number(textScale.toPrecision(2))
  textResetEl.textContent = `${shown}×`
  scheduleFillCards()
}

/**
 * Makes the text on the cards and the edges larger or smaller, within the
 * range, while every card, line and image keeps its place and its size. A card
 * that Wide or Compact sizes by its content still follows its text, and
 * `cardSizeObserver` brings its edges along.
 */
function scaleText(nextTextScale) {
  const textScale = Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, nextTextScale))
  applyTextScale(textScale)
  scheduleViewUrl()
}

/** The view that fits the bounds into the viewport, at zoom 1 at most. */
function fitView(bounds) {
  const rect = wrapperEl.getBoundingClientRect()
  const contentWidth = bounds.maxX - bounds.minX
  const contentHeight = bounds.maxY - bounds.minY

  // A viewport smaller than the padding still gets a scale above zero.
  const availableWidth = Math.max(rect.width - FIT_PADDING * 2, 1)
  const availableHeight = Math.max(rect.height - FIT_PADDING * 2, 1)
  const scaleX = availableWidth / Math.max(contentWidth, 1)
  const scaleY = availableHeight / Math.max(contentHeight, 1)
  const scale = Math.min(scaleX, scaleY, FIT_MAX_ZOOM)

  const x = rect.width / 2 - (bounds.minX + contentWidth / 2) * scale
  const y = rect.height / 2 - (bounds.minY + contentHeight / 2) * scale
  return { x, y, zoom: scale }
}

/**
 * Fits the bounds into the viewport, at zoom 1 at most, and remembers what was
 * fitted: the whole board, or the one node passed in.
 */
function fitToContent(bounds, node = null) {
  const fitted = fitView(bounds)
  view.zoom = fitted.zoom
  // A card fitted on its own leaves the floor where the board's fit put it.
  if (node === null) zoomFloor = Math.min(MIN_ZOOM, fitted.zoom)
  view.x = fitted.x
  view.y = fitted.y
  applyView()
  fittedView = { x: view.x, y: view.y, zoom: view.zoom, node: node }
}

/** True while the view is still the one that was fitted, untouched since. */
function viewIsAsFitted() {
  if (fittedView === null) return false

  const samePan = view.x === fittedView.x && view.y === fittedView.y
  return samePan && view.zoom === fittedView.zoom
}

/**
 * Fits the view again to what it was last fitted to, the board or one card,
 * once the window or a card has changed size — unless the reader has moved
 * the view since.
 */
function refitView() {
  if (!viewIsAsFitted()) return

  const node = fittedView.node
  const nodes = node === null ? layout.nodes : [node]
  fitToContent(contentBounds(nodes), node)
}

/** The card a press or a search put the focus on, or null while the focus is on the board. */
let focusedCardEl = null

/**
 * A press decides what the wheel drives from then on: a card, or the board.
 * Without that, a card sliding under a still pointer during a wheel pan would
 * take the rest of the gesture over, which is what a reader paging through a
 * board never means.
 *
 * The controls, the history, the previews of In and Out and the titles in the
 * margin are neither: pressing one leaves the focus where the reader put it.
 */
function focusOnPress(target) {
  if (!(target instanceof Element)) return
  if (target.closest('.canvas-controls, .canvas-history, .canvas-neighbour, .canvas-margin-title') !== null) return

  focusCard(target.closest('.canvas-node'))
}

/**
 * Puts the focus on a card, or on the board for null, and marks the card that
 * holds it, on the board and in the history.
 */
function focusCard(cardEl) {
  if (cardEl === focusedCardEl) return

  // Only the focused card is ever enlarged, so it goes back as the focus leaves it.
  restoreEnlargedCard()
  // Only the focused card shows its previews, too.
  hideNeighbours()
  if (focusedCardEl !== null) delete focusedCardEl.dataset.focused
  focusedCardEl = cardEl
  if (cardEl !== null) cardEl.dataset.focused = 'true'
  recordFocus(cardEl)
  // The titles in the margin name the cards the focused card has edges to.
  scheduleMarginTitles()
}

/** Fits the view to one card, and puts the focus on it as a press on it would. */
function showCard(node) {
  fitToContent(contentBounds([node]), node)
  focusCard(layout.elements.get(node.id))
}

/**
 * Puts the focus on one card as `showCard` does, but flies the view to it, so
 * that the reader sees where on the board the card sits.
 */
function flyToCard(node) {
  focusCard(layout.elements.get(node.id))
  const target = fitView(contentBounds([node]))
  // The card may change size on the way, so the landing fits it afresh.
  flyView(target, () => fitToContent(contentBounds([node]), node))
}

/** The id of the flight's next animation frame, which a new flight cancels. */
let flightFrame = 0

/**
 * Moves the view to `target`, `{ x, y, zoom }`, along `flightPath`, and calls
 * `land` at the end. A press on the board, or anything else that moves the view
 * on the way, such as a wheel or a button, ends the flight where the view is.
 * With reduced motion asked for, the view lands at once.
 */
function flyView(target, land) {
  cancelAnimationFrame(flightFrame)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion) {
    land()
    return
  }

  const rect = wrapperEl.getBoundingClientRect()
  // The longer side of the viewport measures how much of the canvas is in sight.
  const size = Math.max(rect.width, rect.height)
  const viewport = { centreX: rect.width / 2, centreY: rect.height / 2, size: size }
  const path = flightPath(viewSpan(view, viewport), viewSpan(target, viewport))
  const pathTime = path.length * FLIGHT_MS_PER_UNIT
  const duration = Math.min(Math.max(pathTime, FLIGHT_MIN_MS), FLIGHT_MAX_MS)
  const start = performance.now()
  let shown = { ...view }

  const step = now => {
    const moved = view.x !== shown.x || view.y !== shown.y || view.zoom !== shown.zoom
    if (moved) return
    // A frame's time can be a little earlier than the start.
    const elapsed = Math.max(now - start, 0)
    const t = Math.min(elapsed / duration, 1)
    if (t === 1) {
      land()
      return
    }

    const span = path.at(easeInOut(t))
    view.zoom = viewport.size / span.width
    view.x = viewport.centreX - span.x * view.zoom
    view.y = viewport.centreY - span.y * view.zoom
    applyView()
    shown = { ...view }
    flightFrame = requestAnimationFrame(step)
  }
  flightFrame = requestAnimationFrame(step)
}

/** A wheel scrolls a card's content only over the card the focus is on. */
function wheelScrollsCard(target) {
  if (focusedCardEl === null) return false
  if (!(target instanceof Element)) return false

  const contentEl = target.closest('.canvas-node-content')
  if (contentEl === null) return false
  return contentEl.closest('.canvas-node') === focusedCardEl
}

/**
 * Card content scrolls and selects text, a card title is a link, the controls,
 * the bar in a preview's corner and a card's own buttons are there to be
 * pressed, and an enlarged card is there to be read: a press on any of them
 * neither pans the viewport nor drags the card it belongs to.
 *
 * Leaving the controls out of this would make them unclickable rather than
 * merely draggable: the pan captures the pointer, capture retargets the mouse
 * events a click is derived from, and the button never sees the click.
 */
function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false
  const interactive = '.canvas-node-content, .canvas-node-title-link, .canvas-node-button, .canvas-node-bar, .canvas-node[data-enlarged="true"], .canvas-controls, .canvas-history, .canvas-margin-title'
  return target.closest(interactive) !== null
}

function installViewportControls() {
  let panPointerId = null
  let panOriginX = 0
  let panOriginY = 0

  // In the capture phase, so that presses a card handles itself — its title
  // bar, its resize grip — still move the focus onto it.
  wrapperEl.addEventListener('pointerdown', event => focusOnPress(event.target), true)

  wrapperEl.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.button !== 1) return
    if (event.button === 0 && isInteractiveTarget(event.target)) return

    // A press holds the board where it is, rather than where a flight takes it.
    cancelAnimationFrame(flightFrame)
    panPointerId = event.pointerId
    panOriginX = event.clientX - view.x
    panOriginY = event.clientY - view.y
    wrapperEl.classList.add('is-panning')
    wrapperEl.setPointerCapture(panPointerId)
    event.preventDefault()
  })

  wrapperEl.addEventListener('pointermove', event => {
    if (event.pointerId !== panPointerId) return
    view.x = event.clientX - panOriginX
    view.y = event.clientY - panOriginY
    applyView()
  })

  const endPan = event => {
    if (event.pointerId !== panPointerId) return
    wrapperEl.releasePointerCapture(panPointerId)
    wrapperEl.classList.remove('is-panning')
    panPointerId = null
  }
  wrapperEl.addEventListener('pointerup', endPan)
  wrapperEl.addEventListener('pointercancel', endPan)

  // On a board that leaves the plain wheel to its page, only the focused card
  // scrolls: any other card under the pointer would take the wheel instead.
  if (!config.ownsPage) wrapperEl.dataset.wheel = 'page'
  wrapperEl.addEventListener(
    'wheel',
    event => {
      // A trackpad pinch arrives as a wheel event with ctrlKey set. Alt turns
      // the wheel, or the pinch, into the text size.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        event.preventDefault()
        const factor = Math.exp(-event.deltaY / ZOOM_WHEEL_SENSITIVITY)
        // A board mounted in a page need not start at the window's corner.
        const rect = wrapperEl.getBoundingClientRect()
        const screenX = event.clientX - rect.left
        const screenY = event.clientY - rect.top
        if (event.altKey) scaleText(config.textScale * factor)
        else zoomAt(screenX, screenY, view.zoom * factor)
        return
      }

      if (wheelScrollsCard(event.target)) return
      // A board mounted in another page leaves the plain wheel to that page.
      if (!config.ownsPage) return

      event.preventDefault()
      view.x -= event.deltaX
      view.y -= event.deltaY
      applyView()
    },
    { passive: false },
  )

  zoomInEl.addEventListener('click', () => zoomAroundCentre(view.zoom * ZOOM_STEP))
  zoomOutEl.addEventListener('click', () => zoomAroundCentre(view.zoom / ZOOM_STEP))
  zoomResetEl.addEventListener('click', () => zoomAroundCentre(1))
  textLargerEl.addEventListener('click', () => scaleText(config.textScale * TEXT_SCALE_STEP))
  textSmallerEl.addEventListener('click', () => scaleText(config.textScale / TEXT_SCALE_STEP))
  textResetEl.addEventListener('click', () => scaleText(1))
  // Recomputed at click time: a drag leaves the bounds captured at load stale.
  zoomFitEl.addEventListener('click', () => fitToContent(contentBounds(layout.nodes)))

  // A resized window refits the view, unless the reader has moved it since the
  // fit; a moved view keeps its corner, so the address bar takes its new centre.
  // An enlarged card takes the room the board has now.
  const observer = new ResizeObserver(() => {
    refitView()
    scheduleViewUrl()
    placeEnlargedCard()
    scheduleFillCards()
  })
  observer.observe(wrapperEl)
}

// --------------------------------------------------------------- address bar

/** `at=<x>,<y>,<zoom>`: three decimal numbers, the zoom without a sign. */
const AT_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/

/**
 * The view the `at` parameter names, or null without one: the canvas point at
 * the centre of the viewport, and the zoom. A centre rather than a corner keeps
 * a link on the same spot in a window of another size.
 */
function requestedCentre(params) {
  const value = params.get('at')
  if (value === null) return null

  const match = AT_PATTERN.exec(value)
  if (match === null) throw new Error(`the at parameter accepts <x>,<y>,<zoom>, got ${value}`)
  const [x, y, zoom] = match.slice(1).map(Number)
  return { x: x, y: y, zoom: zoom }
}

/** The text size the `text` parameter names, or 1, the text's own size, without one. */
function requestedTextScale(params) {
  const value = params.get('text')
  if (value === null) return 1

  const textScale = Number(value)
  const inRange = textScale >= MIN_TEXT_SCALE && textScale <= MAX_TEXT_SCALE
  if (!inRange) {
    throw new Error(`the text parameter accepts a number from ${MIN_TEXT_SCALE} to ${MAX_TEXT_SCALE}, got ${value}`)
  }
  return textScale
}

/** Puts the canvas point `at` names at the centre of the viewport, then zooms around it to its zoom. */
function centreView(centre) {
  const rect = wrapperEl.getBoundingClientRect()
  const screenX = rect.width / 2
  const screenY = rect.height / 2
  view.x = screenX - centre.x * view.zoom
  view.y = screenY - centre.y * view.zoom
  zoomAt(screenX, screenY, centre.zoom)
}

/** Fits the view to the card `focus` names, or says that the board holds no such card. */
function showRequestedCard(id) {
  const node = layout.nodes.find(node => node.id === id)
  if (node === undefined) {
    showStatus(`the focus parameter accepts the id of a card on this board, got ${id}`)
    return
  }
  showCard(node)
}

/** The pending rewrite of the address bar, put off while the view keeps moving. */
let viewUrlTimer = 0

function scheduleViewUrl() {
  if (!config.ownsPage) return
  clearTimeout(viewUrlTimer)
  viewUrlTimer = setTimeout(writeViewUrl, VIEW_URL_DELAY)
}

/**
 * The view as a link spells it: `focus=<id>` while it is fitted to one card,
 * nothing while it is fitted to the whole board, which a link opens on anyway,
 * and otherwise `at=` with the canvas point at the centre and the zoom.
 */
function viewParameter() {
  if (viewIsAsFitted()) {
    const node = fittedView.node
    if (node === null) return null
    return `focus=${encodeURIComponent(node.id)}`
  }

  const rect = wrapperEl.getBoundingClientRect()
  const centreX = (rect.width / 2 - view.x) / view.zoom
  const centreY = (rect.height / 2 - view.y) / view.zoom
  const zoom = Number(view.zoom.toPrecision(3))
  return `at=${Math.round(centreX)},${Math.round(centreY)},${zoom}`
}

/**
 * Rewrites `at`, `focus` and `text` in the address bar to the view, and keeps
 * every other parameter as it was typed: URLSearchParams would encode the
 * slashes in `canvas` and the commas in `at`.
 */
function writeViewUrl() {
  const pairs = window.location.search.slice(1).split('&')
  const parameters = pairs.filter(pair => {
    const name = pair.split('=')[0]
    return name !== '' && name !== 'at' && name !== 'focus' && name !== 'text'
  })
  const viewPair = viewParameter()
  if (viewPair !== null) parameters.push(viewPair)
  const textScale = Number(config.textScale.toPrecision(3))
  if (textScale !== 1) parameters.push(`text=${textScale}`)

  const search = parameters.length === 0 ? '' : `?${parameters.join('&')}`
  if (search === window.location.search) return
  history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`)
}

// ------------------------------------------------------------------ dragging

/**
 * What a press on this node moves. Obsidian carries a group's contents with the
 * frame, and the file format records no membership, so a group takes every node
 * whose box lies inside its own — fixed when the drag starts, so a node the
 * frame merely passes over is not picked up along the way.
 */
function movedNodes(node) {
  if (node.type !== 'group') return [node]

  const contained = layout.nodes.filter(other => {
    if (other === node) return false
    const insideX = other.x >= node.x && other.x + other.width <= node.x + node.width
    const insideY = other.y >= node.y && other.y + other.height <= node.y + node.height
    return insideX && insideY
  })
  return [node].concat(contained)
}

/**
 * Re-routes every edge attached to a node whose box has just changed. The
 * previews follow too, as the node may be the card they stand around, or a
 * card one of them shows. So do the titles in the margin.
 */
function relayoutNodeEdges(node) {
  const attached = layout.edgesByNode.get(node.id)
  if (!attached) return
  for (const record of attached) layoutEdge(record)
  placeNeighbours()
  scheduleMarginTitles()
}

/** Moves a node in the data and in the DOM, and re-routes the edges attached to it. */
function placeNode(node, x, y) {
  node.x = x
  node.y = y

  const el = layout.elements.get(node.id)
  el.style.left = `${x}px`
  el.style.top = `${y}px`

  relayoutNodeEdges(node)
}

/**
 * Resizes a node in the data and in the DOM, and re-routes the edges attached
 * to it. A card whose height was following its content stops following it: the
 * reader has just said how tall the card is to be. Pressing a card size puts
 * the whole board back under that size.
 */
function sizeNode(node, width, height) {
  node.width = width
  node.height = height

  const el = layout.elements.get(node.id)
  el.style.width = `${width}px`
  el.style.height = `${height}px`
  el.style.maxHeight = `${height}px`
  delete el.dataset.sized

  relayoutNodeEdges(node)
}

/** From here on the reader arranges the board, so nothing re-fits the view for them. */
function releaseAutoFit() {
  fittedView = null
}

/**
 * Only a title bar moves a card: the rest of it has to stay free for selecting
 * text, scrolling and following links. A group is all frame and holds no
 * content of its own, so any point on it drags.
 */
function startsDrag(target, node) {
  if (!(target instanceof Element)) return false
  if (node.type === 'group') return true
  if (isInteractiveTarget(target)) return false
  return target.closest('.canvas-node-title, .canvas-node-header') !== null
}

/**
 * How far the cards under a drag actually move. With the grid off, that is the
 * pointer's own travel. With it on, the pressed card's top-left corner goes to
 * the nearest grid intersection, and every card carried along with it keeps its
 * offset from that corner — a group lands on the grid without being rearranged
 * inside.
 */
function dragOffset(lead, dx, dy) {
  if (!config.snapToGrid) return { dx: dx, dy: dy }

  const snappedX = nearestGridLine(lead.startX + dx)
  const snappedY = nearestGridLine(lead.startY + dy)
  return { dx: snappedX - lead.startX, dy: snappedY - lead.startY }
}

/** The grid line nearest a canvas coordinate. */
function nearestGridLine(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

/** Turns the grid on or off for later drags, and remembers the choice. */
function applyGridSnap(enabled) {
  config.snapToGrid = enabled
  localStorage.setItem(GRID_SNAP_STORAGE_KEY, String(enabled))
  gridSnapEl.setAttribute('aria-pressed', String(enabled))
}

function installGridSnapControl() {
  applyGridSnap(localStorage.getItem(GRID_SNAP_STORAGE_KEY) === 'true')
  gridSnapEl.addEventListener('click', () => applyGridSnap(!config.snapToGrid))
}

/**
 * A press on a card's title bar moves the card. The wrapper never sees that
 * press, so the background still pans, and everything else on the card is left
 * to scroll, select and navigate as before.
 */
function installNodeDrag(node, el) {
  let dragPointerId = null
  let originX = 0
  let originY = 0
  let dragged = []

  el.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    if (!startsDrag(event.target, node)) return

    dragPointerId = event.pointerId
    originX = event.clientX
    originY = event.clientY
    dragged = movedNodes(node).map(moved => ({ node: moved, startX: moved.x, startY: moved.y }))
    releaseAutoFit()

    el.setPointerCapture(dragPointerId)
    el.classList.add('is-dragging')
    event.stopPropagation()
    event.preventDefault()
  })

  el.addEventListener('pointermove', event => {
    if (event.pointerId !== dragPointerId) return

    // A screen pixel is one canvas unit divided by the zoom factor.
    const dx = (event.clientX - originX) / view.zoom
    const dy = (event.clientY - originY) / view.zoom
    const offset = dragOffset(dragged[0], dx, dy)
    for (const item of dragged) placeNode(item.node, item.startX + offset.dx, item.startY + offset.dy)

    // A card dragged past the layer's edge would have its edges clipped.
    resizeEdgeLayer(contentBounds(layout.nodes))
  })

  const endDrag = event => {
    if (event.pointerId !== dragPointerId) return
    el.releasePointerCapture(dragPointerId)
    el.classList.remove('is-dragging')
    dragPointerId = null
  }
  el.addEventListener('pointerup', endDrag)
  el.addEventListener('pointercancel', endDrag)
}

/**
 * Where a resize drag leaves the card. The corner under the pointer is what the
 * grid catches, not the width: a card's own origin may sit off the grid, and it
 * is the edge being moved that has to line up with its neighbours. No card goes
 * below the minimum, which is a whole number of grid cells either way.
 */
function resizedSize(node, width, height) {
  let targetWidth = width
  let targetHeight = height

  if (config.snapToGrid) {
    targetWidth = nearestGridLine(node.x + width) - node.x
    targetHeight = nearestGridLine(node.y + height) - node.y
  }

  return {
    width: Math.max(targetWidth, MIN_CARD_WIDTH),
    height: Math.max(targetHeight, MIN_CARD_HEIGHT),
  }
}

/**
 * The grip in a card's bottom-right corner resizes it, the way the title row
 * moves it: the press is kept off the wrapper, so the board neither pans nor
 * drags the card along with the resize.
 */
function installNodeResize(node, el) {
  const handleEl = document.createElement('div')
  handleEl.className = 'canvas-node-resize'
  el.appendChild(handleEl)

  let resizePointerId = null
  let originX = 0
  let originY = 0
  let startWidth = 0
  let startHeight = 0

  handleEl.addEventListener('pointerdown', event => {
    if (event.button !== 0) return

    resizePointerId = event.pointerId
    originX = event.clientX
    originY = event.clientY
    startWidth = node.width
    startHeight = node.height
    releaseAutoFit()

    handleEl.setPointerCapture(resizePointerId)
    el.classList.add('is-resizing')
    event.stopPropagation()
    event.preventDefault()
  })

  handleEl.addEventListener('pointermove', event => {
    if (event.pointerId !== resizePointerId) return

    // A screen pixel is one canvas unit divided by the zoom factor.
    const dx = (event.clientX - originX) / view.zoom
    const dy = (event.clientY - originY) / view.zoom
    const size = resizedSize(node, startWidth + dx, startHeight + dy)
    sizeNode(node, size.width, size.height)

    // A card grown past the layer's edge would have its edges clipped.
    resizeEdgeLayer(contentBounds(layout.nodes))
  })

  const endResize = event => {
    if (event.pointerId !== resizePointerId) return
    handleEl.releasePointerCapture(resizePointerId)
    el.classList.remove('is-resizing')
    resizePointerId = null
  }
  handleEl.addEventListener('pointerup', endResize)
  handleEl.addEventListener('pointercancel', endResize)
}

// ----------------------------------------------------------------- card size

/**
 * Sizes one card. `actual` restores the size the file authored; the other modes
 * fix the width for the whole board and leave the height to the content, capped.
 * A group keeps its authored size in every mode: a frame marks out a region of
 * the board rather than holding content that could size it.
 *
 * The node data is rewritten to match, because edge anchors, group membership
 * and the fit all read a node's box out of it. Nothing is written back to the
 * file, so a reload restores the authored sizes.
 */
function applyNodeSize(el, node) {
  const size = CARD_SIZES[config.cardSize]
  const authored = layout.authoredSizes.get(node.id)
  const keepsAuthoredSize = size.width === null || node.type === 'group'

  // The cap is written even where nothing is capped, so that it is always a
  // length: a card whose content overruns the cap takes its height from it, and
  // `none` is not a value the browser can ease away from.
  if (keepsAuthoredSize) {
    node.width = authored.width
    node.height = authored.height
    el.style.width = `${authored.width}px`
    el.style.height = `${authored.height}px`
    el.style.maxHeight = `${authored.height}px`
    delete el.dataset.sized
    return
  }

  node.width = size.width
  el.style.width = `${size.width}px`
  el.style.maxHeight = `${size.maxHeight}px`

  if (holdsEmbed(node)) {
    node.height = size.maxHeight
    el.style.height = `${size.maxHeight}px`
    delete el.dataset.sized
    return
  }

  el.style.height = 'auto'
  el.dataset.sized = 'content'
}

/** Copies the size a card was laid out at into its node data, and tells whether it changed. */
function recordCardSize(node) {
  const el = layout.elements.get(node.id)
  const width = el.offsetWidth
  const height = el.offsetHeight
  const changed = width !== node.width || height !== node.height
  node.width = width
  node.height = height
  return changed
}

/**
 * One read pass, after every card has been written: the browser lays out once,
 * and the size each card settled on goes back into the node data, which the
 * edges, the edge layer and the fit are all computed from.
 */
function readCardSizes() {
  for (const node of layout.nodes) recordCardSize(node)
}

/**
 * Re-routes each edge attached to these resized nodes once, after all of them
 * hold their new box, so an edge between two of them is routed with both. Then
 * fits the edge layer to the board, and returns the board's bounds for the fit.
 * The previews of In and Out, and the titles in the margin, are placed again
 * on the way.
 */
function relayoutAfterResize(nodes) {
  const records = new Set()
  for (const node of nodes) {
    const attached = layout.edgesByNode.get(node.id) ?? []
    for (const record of attached) records.add(record)
  }
  for (const record of records) layoutEdge(record)
  placeNeighbours()
  scheduleMarginTitles()

  const bounds = contentBounds(layout.nodes)
  resizeEdgeLayer(bounds)
  return bounds
}

/** The node each observed card element draws. */
const observedNodes = new WeakMap()

/**
 * A content-sized card knows its height only once the browser has laid it out,
 * again whenever a note, an image or a formula lands, and on every frame of the
 * transition that eases it into a new size. One observer watches every card, so
 * the cards resized in one frame are handled together: their node data follows
 * the elements, and everything computed from the boxes is redone once —
 * including the fit, for as long as the view is still the one this page fitted.
 */
const cardSizeObserver = new ResizeObserver(entries => {
  const resized = []
  for (const entry of entries) {
    // An enlarged card keeps the box it has on the board, and only its place on screen follows its new size.
    if (entry.target === enlargedCardEl) {
      placeEnlargedCard()
      continue
    }
    const node = observedNodes.get(entry.target)
    const changed = recordCardSize(node)
    if (changed) resized.push(node)
  }
  if (resized.length === 0) return

  relayoutAfterResize(resized)
  refitView()
})

function observeCardSize(el, node) {
  observedNodes.set(el, node)
  cardSizeObserver.observe(el)
}

/** Shows which of the three sizes the board is drawn at. */
function markCardSizeControl(sizeName) {
  for (const el of cardSizeEls) {
    el.setAttribute('aria-pressed', String(el.dataset.cardSize === sizeName))
  }
}

/**
 * Re-draws every card at the named size, then re-routes the edges and refits.
 * Cards ease into the new size rather than snap to it, so these are the sizes
 * they are heading for; `observeCardSize` follows the transition frame by frame
 * and brings the edges, the layer and the fit along with it.
 */
function applyCardSize(sizeName) {
  // An enlarged card goes back first, so that its box takes the new size.
  restoreEnlargedCard()
  config.cardSize = sizeName
  localStorage.setItem(CARD_SIZE_STORAGE_KEY, sizeName)
  markCardSizeControl(sizeName)

  for (const node of layout.nodes) applyNodeSize(layout.elements.get(node.id), node)
  readCardSizes()
  const bounds = relayoutAfterResize(layout.nodes)
  fitToContent(bounds)
}

/** The `cards` parameter names a size for one page load; the control persists a choice. */
function preferredCardSize(params) {
  const requested = params.get('cards')
  if (requested !== null) {
    if (Object.hasOwn(CARD_SIZES, requested)) return requested
    const names = CARD_SIZE_NAMES.join(', ')
    throw new Error(`the cards parameter accepts ${names}, got ${requested}`)
  }

  const stored = localStorage.getItem(CARD_SIZE_STORAGE_KEY)
  if (stored !== null && Object.hasOwn(CARD_SIZES, stored)) return stored
  return 'actual'
}

function installCardSizeControl() {
  markCardSizeControl(config.cardSize)
  for (const el of cardSizeEls) {
    // Pressing the size already in force puts cards resized by hand back under it.
    el.addEventListener('click', () => applyCardSize(el.dataset.cardSize))
  }
}

// ------------------------------------------------------------- enlarged card

/** The card drawn whole over the board, or null, and the inline style it has on the board. */
let enlargedCardEl = null
let enlargedCardStyle = ''

/**
 * Draws a card whole, over the board, at a size that can be read: at 100%, or
 * at the board's zoom when that is larger. Its box in the node data stays the
 * one it has on the board, so its edges and the fit stay where they are.
 */
function enlargeCard(cardEl) {
  if (cardEl === enlargedCardEl) return
  restoreEnlargedCard()

  enlargedCardEl = cardEl
  enlargedCardStyle = cardEl.style.cssText
  // A card enlarged on a board zoomed out may not have drawn what it holds yet.
  fillCard(observedNodes.get(cardEl))
  cardEl.dataset.enlarged = 'true'
  cardEl.querySelector('.canvas-node-enlarge').setAttribute('aria-pressed', 'true')
  placeEnlargedCard()
}

/**
 * Sizes the enlarged card to its content, from its own box on the board up to
 * the room right of and below the top-left corner the board draws it at. Where
 * that room is smaller than the same card in Wide, the card moves left or up,
 * only as far as it takes to be that large.
 * Sizes are in the enlarged card's own pixels, which the card scales from the
 * board's zoom to its own.
 */
function placeEnlargedCard() {
  if (enlargedCardEl === null) return

  const cardEl = enlargedCardEl
  const node = observedNodes.get(cardEl)
  const cardZoom = Math.max(view.zoom, 1)
  // The card on the board, in the enlarged card's pixels from the board's top-left corner.
  const boxX = (view.x + node.x * view.zoom) / cardZoom
  const boxY = (view.y + node.y * view.zoom) / cardZoom
  const boxWidth = node.width * view.zoom / cardZoom
  const boxHeight = node.height * view.zoom / cardZoom

  // The room inside the board, ENLARGED_MARGIN on screen clear of its edges and of the controls.
  const margin = ENLARGED_MARGIN / cardZoom
  const roomRight = wrapperEl.getBoundingClientRect().width / cardZoom - margin
  const roomBottom = controlsEl.offsetTop / cardZoom - margin
  // As large as the room, but never smaller than the card on the board.
  const maxWidth = Math.max(roomRight - margin, boxWidth)
  const maxHeight = Math.max(roomBottom - margin, boxHeight)

  // The room right of and below the card's corner, but at least the room of the same card in Wide.
  const cornerWidth = Math.max(roomRight - boxX, ENLARGED_MIN_SIZE.width, boxWidth)
  const cornerHeight = Math.max(roomBottom - boxY, ENLARGED_MIN_SIZE.maxHeight, boxHeight)

  const wantedWidth = Math.max(node.width, ENLARGED_MIN_SIZE.width)
  const width = Math.min(wantedWidth, cornerWidth, maxWidth)
  const heightCap = Math.min(cornerHeight, maxHeight)
  cardEl.style.width = `${width}px`
  // An iframe has no height of its own, so a card holding one takes all the room it has.
  cardEl.style.height = holdsEmbed(node) ? `${heightCap}px` : 'auto'
  cardEl.style.minHeight = `${boxHeight}px`
  cardEl.style.maxHeight = `${heightCap}px`
  // offsetHeight rounds to whole pixels, so that it can pass the cap by a fraction.
  const height = Math.min(cardEl.offsetHeight, heightCap)

  const shiftX = enlargedShift(boxX, width, boxWidth, roomRight)
  const shiftY = enlargedShift(boxY, height, boxHeight, roomBottom)
  cardEl.style.transform = `scale(${cardZoom / view.zoom}) translate(${-shiftX}px, ${-shiftY}px)`
  cardEl.style.setProperty('--zoom', cardZoom)
}

/**
 * How far an enlarged card moves left or up from its box on the board, along
 * one axis: as far as it takes to end at `roomEnd`, but never so far that it
 * stops covering that box, where its edges end.
 */
function enlargedShift(boxStart, size, boxSize, roomEnd) {
  const overflow = boxStart + size - roomEnd
  const slack = size - boxSize
  return Math.max(0, Math.min(overflow, slack))
}

/**
 * Puts the enlarged card back in its box on the board. It snaps back rather
 * than easing out of its enlarged size, as `cardSizeObserver` would carry its
 * edges along through every frame of the easing.
 */
function restoreEnlargedCard() {
  if (enlargedCardEl === null) return

  const cardEl = enlargedCardEl
  enlargedCardEl = null
  cardEl.style.cssText = enlargedCardStyle
  // Lays the card out at its own size while `data-enlarged` still turns its transition off.
  void cardEl.offsetHeight
  delete cardEl.dataset.enlarged
  cardEl.querySelector('.canvas-node-enlarge').setAttribute('aria-pressed', 'false')
}

/** lucide `maximize-2`: the card opens out to its whole content. */
const ENLARGE_ICON = '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>'

/**
 * The button in a card's top-left corner enlarges the card until it is pressed
 * again, or until the focus leaves the card. It is how a touch screen, with no
 * Space to press, reads a card whole.
 */
function installNodeEnlarge(el) {
  const buttonEl = document.createElement('button')
  buttonEl.className = 'canvas-node-button canvas-node-enlarge'
  buttonEl.type = 'button'
  buttonEl.title = 'Show the whole card, or press Space'
  buttonEl.setAttribute('aria-pressed', 'false')
  buttonEl.appendChild(createIcon(ENLARGE_ICON))
  el.appendChild(buttonEl)

  // A pressed button would keep the keyboard focus, and a later Space would press it again.
  buttonEl.addEventListener('pointerdown', event => event.preventDefault())
  buttonEl.addEventListener('click', () => {
    // Enter on the button skips the press that puts the focus on its card.
    focusCard(el)
    if (enlargedCardEl === el) restoreEnlargedCard()
    else enlargeCard(el)
  })
}

/** True for a form field or for editable text, where Space types or toggles. */
function isField(el) {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || el.matches('input, textarea, select')
}

/**
 * Whether a press of Space enlarges the focused card, or puts it back. On a
 * board mounted in another page, Space scrolls that page, so the board takes it
 * only while the pointer is over the board. A form field keeps its Space, and
 * so does a file shown over the board.
 */
function spaceToggles(event, pointerOverBoard) {
  if (focusedCardEl === null) return false
  if (focusedCardEl.dataset.type === 'group') return false
  if (wrapperEl.inert) return false
  if (!config.ownsPage && !pointerOverBoard) return false

  const hasModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
  if (hasModifier) return false
  // A key pressed inside the board names the board's host as its target.
  const target = event.composedPath()[0]
  return !isField(target)
}

/**
 * A press of Space enlarges the focused card, and the next press puts it back,
 * as the focus leaving the card does.
 */
function installEnlargeKey() {
  let pointerOverBoard = false
  let spaceHeld = false
  wrapperEl.addEventListener('pointerenter', () => {
    pointerOverBoard = true
  })
  wrapperEl.addEventListener('pointerleave', () => {
    pointerOverBoard = false
  })

  document.addEventListener('keydown', event => {
    if (event.code !== 'Space') return
    if (!spaceToggles(event, pointerOverBoard)) return

    // Space would scroll the page, or press the button that has the keyboard focus.
    event.preventDefault()
    if (event.repeat) return
    spaceHeld = true
    if (enlargedCardEl === focusedCardEl) restoreEnlargedCard()
    else enlargeCard(focusedCardEl)
  })

  // A button that has the keyboard focus is pressed as Space goes up, so the
  // board keeps the release of a press it took.
  document.addEventListener('keyup', event => {
    if (event.code !== 'Space') return
    if (!spaceHeld) return

    spaceHeld = false
    event.preventDefault()
  })

  // Space let go in another window never reaches this one.
  window.addEventListener('blur', () => {
    spaceHeld = false
  })
}

/**
 * Escape takes the focus off the focused card, as a press on the board does.
 * The card preview lies over the board, so Escape closes an open preview first,
 * and the next press takes the focus. A form field keeps its Escape. While a
 * file covers the board, the board is out of reach and keeps its focus.
 */
function installEscapeKey() {
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (previewedNode !== null) {
      closeCardPreview()
      return
    }
    if (wrapperEl.inert) return
    // A key pressed inside the board names the board's host as its target.
    const target = event.composedPath()[0]
    if (isField(target)) return

    focusCard(null)
  })
}

// -------------------------------------------------------------- card preview

/** The card the preview shows, or null while the preview is closed. */
let previewedNode = null

/**
 * The box of the link that opened the preview, in pixels from the board's
 * top-left corner. A link in the preview shows its card in the same place, as
 * the card it names replaces the link.
 */
let previewAnchor = null

/**
 * Shows a file card in the preview, beside the link that names it, over the
 * board and over a file shown on it. The preview draws the card's file afresh,
 * at the text's own size, into an element of its own: a note still loading for
 * an earlier preview then lands where nobody sees it.
 */
function showCardPreview(node, linkEl) {
  const inPreview = cardPreviewEl.contains(linkEl)
  if (!inPreview) {
    const hostRect = hostEl.getBoundingClientRect()
    const linkRect = linkEl.getBoundingClientRect()
    const left = linkRect.left - hostRect.left
    const top = linkRect.top - hostRect.top
    previewAnchor = { left, top, bottom: top + linkRect.height }
  }
  previewedNode = node
  cardPreviewTitleEl.textContent = nodeTitleText(node)
  const contentEl = document.createElement('div')
  contentEl.className = 'card-preview-content'
  fillFileNode(contentEl, node)
  cardPreviewBodyEl.replaceChildren(contentEl)
  cardPreviewEl.hidden = false
  placeCardPreview()
}

/**
 * Places the preview below its anchor, or above it when there is more room
 * there, PREVIEW_GAP clear of the anchor and of the board's edges.
 */
function placeCardPreview() {
  const hostRect = hostEl.getBoundingClientRect()
  const width = Math.min(PREVIEW_SIZE.width, hostRect.width - PREVIEW_GAP * 2)
  const maxLeft = hostRect.width - PREVIEW_GAP - width
  const left = Math.max(Math.min(previewAnchor.left, maxLeft), PREVIEW_GAP)
  cardPreviewEl.style.width = `${width}px`
  cardPreviewEl.style.left = `${left}px`

  const roomBelow = hostRect.height - previewAnchor.bottom - PREVIEW_GAP * 2
  const roomAbove = previewAnchor.top - PREVIEW_GAP * 2
  const below = roomBelow >= PREVIEW_SIZE.maxHeight || roomBelow >= roomAbove
  const room = below ? roomBelow : roomAbove
  const height = Math.min(PREVIEW_SIZE.maxHeight, room)
  cardPreviewEl.style.maxHeight = `${height}px`
  // An iframe has no height of its own, so a preview holding one takes all of its own.
  cardPreviewEl.style.height = holdsEmbed(previewedNode) ? `${height}px` : ''
  cardPreviewEl.style.top = below ? `${previewAnchor.bottom + PREVIEW_GAP}px` : ''
  cardPreviewEl.style.bottom = below ? '' : `${hostRect.height - previewAnchor.top + PREVIEW_GAP}px`
}

function closeCardPreview() {
  previewedNode = null
  cardPreviewEl.hidden = true
  cardPreviewBodyEl.replaceChildren()
}

/**
 * Go to card flies the view to the card the preview shows. The preview closes
 * on its × button, on Escape, and on a press anywhere outside it, which is also
 * how a press on another link replaces it.
 */
function installCardPreview() {
  cardPreviewGoEl.addEventListener('click', () => {
    const node = previewedNode
    closeCardPreview()
    closeFileView()
    flyToCard(node)
  })
  cardPreviewCloseEl.addEventListener('click', closeCardPreview)
  // In the capture phase, as a press on a card's title row goes no further.
  document.addEventListener(
    'pointerdown',
    event => {
      const inPreview = event.composedPath().includes(cardPreviewEl)
      if (!inPreview) closeCardPreview()
    },
    true,
  )
}

// ------------------------------------------------------------- focus history

/** The cards the focus has been on, the latest first, each once, at most `config.historyLength` of them. */
const focusHistory = []

/** The number of cards the `history` parameter names, or DEFAULT_HISTORY_LENGTH without one. */
function requestedHistoryLength(params) {
  const value = params.get('history')
  if (value === null) return DEFAULT_HISTORY_LENGTH

  const historyLength = Number(value)
  const isCount = Number.isInteger(historyLength) && historyLength >= 1
  if (!isCount) throw new Error(`the history parameter accepts a whole number from 1 up, got ${value}`)
  return historyLength
}

/**
 * Puts a card that takes the focus first in the history. The list is drawn
 * again either way: its mark follows the focus, and goes when the focus moves
 * to the board.
 */
function recordFocus(cardEl) {
  if (cardEl !== null) {
    const node = layout.nodes.find(node => layout.elements.get(node.id) === cardEl)
    const index = focusHistory.indexOf(node)
    if (index >= 0) focusHistory.splice(index, 1)
    focusHistory.unshift(node)
    // The oldest cards past the length drop off the end.
    focusHistory.splice(config.historyLength)
  }
  drawFocusHistory()
}

function historyEntryElement(node) {
  const entryEl = document.createElement('button')
  entryEl.className = 'canvas-history-entry'
  entryEl.textContent = cardName(node) || 'Untitled'
  const holdsFocus = layout.elements.get(node.id) === focusedCardEl
  if (holdsFocus) entryEl.setAttribute('aria-current', 'true')
  entryEl.addEventListener('click', () => flyToCard(node))
  return entryEl
}

function drawFocusHistory() {
  const entryEls = focusHistory.map(historyEntryElement)
  if (entryEls.length === 0) {
    const emptyEl = document.createElement('div')
    emptyEl.className = 'canvas-history-empty'
    emptyEl.textContent = 'No card has had the focus yet'
    entryEls.push(emptyEl)
  }
  historyListEl.replaceChildren(...entryEls)
  // A long list shows its top, where the card that holds the focus is.
  historyListEl.scrollTop = 0
}

/** Shows or hides the history, and remembers the choice. */
function applyHistoryPane(shown) {
  historyEl.hidden = !shown
  localStorage.setItem(HISTORY_STORAGE_KEY, String(shown))
  historyToggleEl.setAttribute('aria-pressed', String(shown))
}

/**
 * History lists, in the board's top-right corner, the cards the focus has been
 * on; a click on one flies the view back to it.
 */
function installFocusHistory() {
  drawFocusHistory()
  applyHistoryPane(localStorage.getItem(HISTORY_STORAGE_KEY) === 'true')
  historyToggleEl.addEventListener('click', () => applyHistoryPane(historyEl.hidden))
  // The wheel scrolls a long list, rather than moving the board under it.
  historyEl.addEventListener('wheel', event => event.stopPropagation())
}

// ---------------------------------------------------------------- neighbours

/** In and Out, keyed by the direction of the dependency edges whose cards they preview. */
const NEIGHBOUR_BUTTONS = {
  in: { label: 'In', title: 'Show the cards to read before this one' },
  out: { label: 'Out', title: 'Show the cards to read after this one' },
}

/** The directions In and Out preview the focused card's neighbours in: `in`, `out`, both or neither. */
const shownDirections = new Set()

/** The focused card while In or Out shows its previews, or null. */
let surroundedNode = null

/** The previews on the board, each `{ node, record, direction, el, box, link, side }`. */
let neighbourPreviews = []

/**
 * A dependency edge leaves a card by its right side, and enters by its left
 * side a card that builds on the first. An edge on the top side of a card
 * joins a related topic, and one on the bottom side an example.
 */
function isDependency(record) {
  const { fromSide, toSide } = edgeSides(record)
  return fromSide === 'right' && toSide === 'left'
}

/**
 * The cards to preview around a card, in the given directions, each with the
 * dependency edge that joins it to the card and that edge's direction: `in`
 * for an edge into the card, from a card to read before it, and `out` for one
 * out of it, to a card to read after it. A card that several edges join in
 * one direction is previewed once in that direction, for the first of them.
 */
function findNeighbours(node, directions) {
  const found = new Map()
  const attached = layout.edgesByNode.get(node.id) ?? []
  for (const record of attached) {
    // An edge from a card to itself leads to no other card.
    if (record.fromNode === record.toNode) continue
    if (!isDependency(record)) continue

    const direction = record.toNode === node ? 'in' : 'out'
    if (!directions.has(direction)) continue
    const other = direction === 'in' ? record.fromNode : record.toNode
    const key = `${direction} ${other.id}`
    if (found.has(key)) continue
    found.set(key, { node: other, record, direction })
  }
  return [...found.values()]
}

/** lucide `locate-fixed`: the button finds the card on the board. */
const LOCATE_ICON =
  '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/>' +
  '<line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/>' +
  '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>'

/**
 * A card's buttons: In on its left side and Out on its right side, where the
 * dependency edges enter and leave it, and the button that enlarges the card.
 * In, or Out, is greyed out on a card that no dependency edge leads into, or
 * out of.
 */
function installNodeButtons(node) {
  const el = layout.elements.get(node.id)
  for (const [direction, { label, title }] of Object.entries(NEIGHBOUR_BUTTONS)) {
    const buttonEl = document.createElement('button')
    buttonEl.className = 'canvas-node-button canvas-node-neighbours'
    buttonEl.type = 'button'
    buttonEl.dataset.direction = direction
    buttonEl.textContent = label
    buttonEl.title = title
    buttonEl.setAttribute('aria-pressed', 'false')
    const neighbours = findNeighbours(node, new Set([direction]))
    buttonEl.disabled = neighbours.length === 0
    // As with the enlarge button, a press leaves the keyboard focus where it was.
    buttonEl.addEventListener('pointerdown', event => event.preventDefault())
    buttonEl.addEventListener('click', () => toggleNeighbours(node, direction))
    el.appendChild(buttonEl)
  }
  // A group is all frame, with nothing to read.
  if (node.type !== 'group') installNodeEnlarge(el)
}

/**
 * Shows the previews of a card's neighbours in one direction, or removes them.
 * The card is the focused one, as In and Out show on no other card.
 */
function toggleNeighbours(node, direction) {
  if (shownDirections.has(direction)) shownDirections.delete(direction)
  else shownDirections.add(direction)
  surroundedNode = shownDirections.size === 0 ? null : node
  markNeighbourButtons(node)
  drawNeighbours()
}

/** Removes the previews as the focus leaves their card, and turns the card's In and Out off. */
function hideNeighbours() {
  if (surroundedNode === null) return

  const node = surroundedNode
  shownDirections.clear()
  surroundedNode = null
  markNeighbourButtons(node)
  drawNeighbours()
}

/** Marks a card's In and Out as pressed while their previews are on the board. */
function markNeighbourButtons(node) {
  const buttonEls = layout.elements.get(node.id).querySelectorAll('.canvas-node-neighbours')
  for (const buttonEl of buttonEls) {
    const shown = shownDirections.has(buttonEl.dataset.direction)
    buttonEl.setAttribute('aria-pressed', String(shown))
  }
}

/**
 * A preview draws its card afresh, as the board draws it, with a bar in its
 * top-right corner whose button flies the view to the card. A copy of the edge
 * joins it to the surrounded card. The preview and the copy take the colour of
 * their direction. `placeNeighbours` sets the preview's box, and the sides of
 * the copy.
 */
function createNeighbourPreview(found) {
  const el = document.createElement('div')
  el.className = 'canvas-neighbour'
  el.dataset.direction = found.direction
  fillNodeElement(el, found.node)
  fillNodeContent(el, found.node)

  const goEl = document.createElement('button')
  goEl.className = 'canvas-neighbour-go'
  goEl.type = 'button'
  goEl.title = 'Fly to this card on the board'
  goEl.appendChild(createIcon(LOCATE_ICON))
  goEl.addEventListener('click', () => flyToCard(found.node))
  const barEl = document.createElement('div')
  barEl.className = 'canvas-node-bar'
  barEl.appendChild(goEl)
  el.appendChild(barEl)

  const box = { x: 0, y: 0, width: 0, height: 0 }
  const isInput = found.direction === 'in'
  const fromNode = isInput ? box : surroundedNode
  const toNode = isInput ? surroundedNode : box
  const edge = { ...found.record.edge, color: undefined }
  const link = createEdgeElements(edge, fromNode, toNode)
  link.group.setAttribute('class', 'canvas-neighbour-link')
  link.group.setAttribute('data-direction', found.direction)
  return { ...found, el, box, link, side: null }
}

/** Draws the previews around the surrounded card afresh, for the directions shown. */
function drawNeighbours() {
  neighbourLinksEl.replaceChildren()
  neighboursEl.replaceChildren(neighbourLinksEl)
  neighbourPreviews = []
  if (surroundedNode === null) return

  for (const found of findNeighbours(surroundedNode, shownDirections)) {
    const preview = createNeighbourPreview(found)
    neighbourLinksEl.appendChild(preview.link.group)
    neighboursEl.appendChild(preview.el)
    neighbourPreviews.push(preview)
  }
  placeNeighbours()
}

/** The side of the surrounded card that a preview's edge meets, where the board draws that edge. */
function neighbourSide(preview) {
  const edge = preview.record.edge
  const side = preview.direction === 'in' ? edge.toSide : edge.fromSide
  if (side) return side
  return inferSide(surroundedNode, preview.node)
}

/**
 * Lines up the previews on one side of a card, in a column beside it or in a
 * row above or below it, in the order their cards have along that side. The
 * line is centred on the middle of the side, where the edges meet it.
 */
function stackNeighbours(card, side, previews) {
  const isColumn = side === 'left' || side === 'right'
  const centre = node => (isColumn ? node.y + node.height / 2 : node.x + node.width / 2)
  previews.sort((a, b) => centre(a.node) - centre(b.node))

  let length = NEIGHBOUR_GAP * (previews.length - 1)
  for (const { node, box } of previews) {
    box.width = Math.min(node.width, NEIGHBOUR_SIZE.width)
    box.height = Math.min(node.height, NEIGHBOUR_SIZE.maxHeight)
    length += isColumn ? box.height : box.width
  }

  const middle = sideAnchor(card, side)
  let along = (isColumn ? middle.y : middle.x) - length / 2
  for (const { box } of previews) {
    if (side === 'left') box.x = card.x - NEIGHBOUR_DISTANCE - box.width
    else if (side === 'right') box.x = card.x + card.width + NEIGHBOUR_DISTANCE
    else if (side === 'top') box.y = card.y - NEIGHBOUR_DISTANCE - box.height
    else box.y = card.y + card.height + NEIGHBOUR_DISTANCE

    if (isColumn) box.y = along
    else box.x = along
    along += (isColumn ? box.height : box.width) + NEIGHBOUR_GAP
  }
}

/**
 * Lines the previews up around the surrounded card, each on the side its edge
 * meets, and routes each copy of an edge from the preview's side that faces
 * the card. The previews' edge layer grows to take them in.
 */
function placeNeighbours() {
  if (neighbourPreviews.length === 0) return

  const card = surroundedNode
  for (const preview of neighbourPreviews) preview.side = neighbourSide(preview)
  for (const side of Object.keys(SIDE_NORMALS)) {
    const previews = neighbourPreviews.filter(preview => preview.side === side)
    stackNeighbours(card, side, previews)
  }

  for (const preview of neighbourPreviews) {
    const { el, box, link } = preview
    el.style.left = `${box.x}px`
    el.style.top = `${box.y}px`
    el.style.width = `${box.width}px`
    el.style.height = `${box.height}px`

    const facing = OPPOSITE_SIDES[preview.side]
    const isInput = preview.direction === 'in'
    link.edge.fromSide = isInput ? facing : preview.side
    link.edge.toSide = isInput ? preview.side : facing
    layoutEdge(link)
  }

  const boxes = neighbourPreviews.map(preview => preview.box)
  resizeEdgeLayer(contentBounds([card, ...boxes]), neighbourLinksEl)
}

// ------------------------------------------------------------- margin titles

/** The element of each title in the margin, keyed by the node it names. */
const marginTitleEls = new Map()

/** The id of the frame that draws the titles in the margin, or 0 while none is due. */
let marginFrame = 0

/** Draws the titles in the margin on the next frame, once however many changes ask for it. */
function scheduleMarginTitles() {
  if (marginFrame !== 0) return
  marginFrame = requestAnimationFrame(() => {
    marginFrame = 0
    drawMarginTitles()
  })
}

/** The part of the board in view inside the margin of a viewport this size, in canvas units. */
function viewRect(width, height) {
  const minX = (MARGIN_TITLE_BAND - view.x) / view.zoom
  const minY = (MARGIN_TITLE_BAND - view.y) / view.zoom
  const maxX = (width - MARGIN_TITLE_BAND - view.x) / view.zoom
  const maxY = (height - MARGIN_TITLE_BAND - view.y) / view.zoom
  return { minX, minY, maxX, maxY }
}

/**
 * Where an edge leaves the rect for the last time, on its way from the card
 * `node` in view to the card out of view at its other end: the point just past
 * the border, and the side of the rect that point lies beyond. An edge that
 * runs outside the rect all the way leaves it where it starts.
 */
function edgeExit(record, node, rect) {
  const { fromSide, toSide } = edgeSides(record)
  const geometry = edgeGeometry(record.fromNode, fromSide, record.toNode, toSide)
  const startsAtNode = record.fromNode === node
  const pointAt = t => {
    const curveT = startsAtNode ? t : 1 - t
    return bezierPoint(geometry, curveT)
  }

  const exit = lastExit(pointAt, rect) ?? 0
  const point = pointAt(exit)
  const side = sideBeyond(rect, point)
  return { point, side }
}

/** How far along its side of the viewport, in pixels, a point beyond that side of the rect stands. */
function screenAlong(point, side, rect) {
  const isRow = side === 'top' || side === 'bottom'
  if (isRow) {
    const x = Math.min(Math.max(point.x, rect.minX), rect.maxX)
    return view.x + x * view.zoom
  }
  const y = Math.min(Math.max(point.y, rect.minY), rect.maxY)
  return view.y + y * view.zoom
}

/**
 * The cards out of view that an edge joins to the focused card, while that
 * card is in view, each as `{ node, record, side, along }`. `record` is the
 * first edge between the two cards. It leaves the view by `side` of the
 * viewport, `along` pixels along it.
 */
function findMarginTitles(rect) {
  if (focusedCardEl === null) return []
  const node = layout.nodes.find(node => layout.elements.get(node.id) === focusedCardEl)
  if (!meetsRect(node, rect)) return []

  const found = new Map()
  const attached = layout.edgesByNode.get(node.id) ?? []
  for (const record of attached) {
    const other = record.fromNode === node ? record.toNode : record.fromNode
    if (found.has(other)) continue
    // An edge from the card to itself leads to a card in view.
    if (meetsRect(other, rect)) continue

    const { point, side } = edgeExit(record, node, rect)
    const along = screenAlong(point, side, rect)
    found.set(other, { node: other, record, side, along })
  }
  return [...found.values()]
}

/** A title for the margin. A click on it flies the view to its card, and puts the focus there. */
function createMarginTitle(node) {
  const name = cardName(node) || 'Untitled'
  const nameEl = document.createElement('span')
  nameEl.className = 'canvas-margin-title-name'
  nameEl.textContent = name

  const el = document.createElement('button')
  el.className = 'canvas-margin-title'
  el.type = 'button'
  el.title = name
  el.style.height = `${MARGIN_TITLE_HEIGHT}px`
  el.style.maxWidth = `${MARGIN_TITLE_MAX_WIDTH}px`
  el.appendChild(nameEl)
  el.addEventListener('click', () => flyToCard(node))
  marginEl.appendChild(el)
  return el
}

/** Points a title's arrow out of its side of the viewport, in the colour of the edge it stands for. */
function markMarginTitle(title) {
  const { el, record, side } = title
  el.dataset.side = side
  const color = resolveColor(record.edge.color)
  if (color) el.style.setProperty('--edge-color', color)
  else el.style.removeProperty('--edge-color')
}

/**
 * Shows a title in the margin for each card out of view that an edge joins to
 * the focused card, and removes the titles no card needs any longer. A title
 * that stays keeps its element, which only moves.
 */
function drawMarginTitles() {
  const boardRect = wrapperEl.getBoundingClientRect()
  const titles = findMarginTitles(viewRect(boardRect.width, boardRect.height))
  const named = new Set(titles.map(title => title.node))
  for (const [node, el] of marginTitleEls) {
    if (named.has(node)) continue
    el.remove()
    marginTitleEls.delete(node)
  }

  for (const title of titles) {
    let el = marginTitleEls.get(title.node)
    if (el === undefined) {
      el = createMarginTitle(title.node)
      marginTitleEls.set(title.node, el)
    }
    // A title that found no room last time shows again, to be measured.
    el.hidden = false
    title.el = el
    markMarginTitle(title)
  }
  // The boxes and the widths are all read before any title moves, so that
  // reading them lays the board out once.
  const boxes = coveringBoxes(boardRect)
  for (const title of titles) title.width = title.el.getBoundingClientRect().width
  placeMarginTitles(titles, boardRect, boxes)
}

/** The boxes of the controls, and of the history while it shows, in pixels from the board's top-left corner. */
function coveringBoxes(boardRect) {
  const els = historyEl.hidden ? [controlsEl] : [controlsEl, historyEl]
  return els.map(el => {
    const rect = el.getBoundingClientRect()
    const left = rect.left - boardRect.left
    const top = rect.top - boardRect.top
    return { left, top, right: left + rect.width, bottom: top + rect.height }
  })
}

/**
 * The room the titles on one side of the viewport take: `along` that side, and
 * `across` it, each as `{ start, end }` in pixels from the board's top-left
 * corner.
 */
function marginLane(side, boardRect) {
  const isRow = side === 'top' || side === 'bottom'
  // The titles on the left and the right stop short of the rows at the top and
  // the bottom, so that no two titles meet in a corner.
  let along = { start: MARGIN_TITLE_BAND, end: boardRect.height - MARGIN_TITLE_BAND }
  if (isRow) along = { start: MARGIN_TITLE_INSET, end: boardRect.width - MARGIN_TITLE_INSET }

  const depth = isRow ? MARGIN_TITLE_HEIGHT : MARGIN_TITLE_MAX_WIDTH
  const breadth = isRow ? boardRect.height : boardRect.width
  const atStart = side === 'top' || side === 'left'
  const acrossStart = atStart ? MARGIN_TITLE_INSET : breadth - MARGIN_TITLE_INSET - depth
  const across = { start: acrossStart, end: acrossStart + depth }
  return { isRow, along, across }
}

/**
 * The stretches along a lane that the boxes cover where they cross it, each
 * MARGIN_TITLE_GAP longer at both ends.
 */
function coveredStretches(lane, boxes) {
  const stretches = []
  for (const box of boxes) {
    const across = lane.isRow ? { start: box.top, end: box.bottom } : { start: box.left, end: box.right }
    const crosses = across.start < lane.across.end && across.end > lane.across.start
    if (!crosses) continue

    const along = lane.isRow ? { start: box.left, end: box.right } : { start: box.top, end: box.bottom }
    stretches.push({ start: along.start - MARGIN_TITLE_GAP, end: along.end + MARGIN_TITLE_GAP })
  }
  return stretches
}

/**
 * Lines the titles up along each side of the viewport, each as near as it fits
 * to where its edge leaves the view, MARGIN_TITLE_GAP clear of the other
 * titles, of the controls and of the history. A title with no room left on its
 * side hides.
 */
function placeMarginTitles(titles, boardRect, boxes) {
  for (const side of Object.keys(SIDE_NORMALS)) {
    const lane = marginLane(side, boardRect)
    const taken = coveredStretches(lane, boxes)
    const onSide = titles.filter(title => title.side === side)
    onSide.sort((a, b) => a.along - b.along)
    for (const title of onSide) {
      const length = lane.isRow ? title.width : MARGIN_TITLE_HEIGHT
      const free = freeStretches(lane.along, taken)
      const start = nearestFit(title.along - length / 2, length, free)
      title.el.hidden = start === null
      if (start === null) continue

      taken.push({ start: start - MARGIN_TITLE_GAP, end: start + length + MARGIN_TITLE_GAP })
      placeMarginTitle(title, lane, start)
    }
  }
}

/** Puts a title `start` pixels along its lane, against the viewport's edge. */
function placeMarginTitle(title, lane, start) {
  let left = start
  let top = lane.across.start
  if (!lane.isRow) {
    const atRight = title.side === 'right'
    left = atRight ? lane.across.end - title.width : lane.across.start
    top = start
  }
  title.el.style.left = `${left}px`
  title.el.style.top = `${top}px`
}

/**
 * The titles in the margin follow the viewport's edges, and keep clear of the
 * controls and the history, as any of them changes size. The controls are
 * watched for changes to their content rather than to their size: their zoom
 * label changes inside `cardSizeObserver`'s callback, and a ResizeObserver on
 * an element above the cards would report that change as a loop error.
 */
function installMarginTitles() {
  const observer = new ResizeObserver(scheduleMarginTitles)
  observer.observe(wrapperEl)
  observer.observe(historyEl)
  const controlsObserver = new MutationObserver(scheduleMarginTitles)
  controlsObserver.observe(controlsEl, { subtree: true, childList: true, characterData: true, attributes: true })
}

// -------------------------------------------------------------------- search

/** What a search result calls a card: the name or label it shows, or its first line. */
function cardName(node) {
  if (node.type === 'file' || node.type === 'link') return nodeTitleText(node)
  if (node.type === 'group') return node.label ?? ''
  if (node.type === 'text') return node.text.trim().split('\n')[0]
  return ''
}

/** The markdown a card shows, as text: a text card's header, and the card's text or note once it has drawn it. */
function renderedText(node) {
  const previewEls = layout.elements.get(node.id).querySelectorAll('.markdown-preview')
  const texts = [...previewEls].map(previewEl => previewEl.textContent)
  return texts.join('\n')
}

/**
 * The cards whose name or rendered text holds the query, ignoring case. A card
 * whose name holds it comes first, since that is usually the card meant.
 */
function searchCards(query) {
  const needle = query.toLowerCase()
  const named = []
  const mentioned = []
  for (const node of layout.nodes) {
    const name = cardName(node).toLowerCase()
    if (name.includes(needle)) {
      named.push(node)
      continue
    }

    const text = renderedText(node).toLowerCase()
    if (text.includes(needle)) mentioned.push(node)
  }
  return named.concat(mentioned)
}

function pickSearchResult(node) {
  searchResultsEl.hidden = true
  flyToCard(node)
}

function searchResultElement(node) {
  const resultEl = document.createElement('button')
  resultEl.className = 'canvas-search-result'
  resultEl.textContent = cardName(node)
  resultEl.addEventListener('click', () => pickSearchResult(node))
  return resultEl
}

/** Lists the cards that match the search box, or hides the list while the box is empty. */
function showSearchResults() {
  const query = searchEl.value.trim()
  if (query === '') {
    searchResultsEl.hidden = true
    return
  }

  const resultEls = searchCards(query).map(searchResultElement)
  if (resultEls.length === 0) {
    const emptyEl = document.createElement('div')
    emptyEl.className = 'canvas-search-empty'
    emptyEl.textContent = 'No card matches'
    resultEls.push(emptyEl)
  }
  searchResultsEl.replaceChildren(...resultEls)
  searchResultsEl.hidden = false
}

/**
 * Typing lists the matching cards above the box; picking one, or pressing
 * Enter for the first, flies the view to it. A press anywhere else closes the
 * list and keeps the query, so a click in the box brings the list back.
 */
function installSearch() {
  // A search looks through what every card holds, so a press in the box draws
  // every card, and the notes load while the query is typed.
  searchEl.addEventListener('focus', () => {
    for (const node of unfilledNodes) fillCard(node)
  })
  searchEl.addEventListener('input', showSearchResults)
  searchEl.addEventListener('click', showSearchResults)
  searchEl.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      searchEl.value = ''
      searchResultsEl.hidden = true
      return
    }
    if (event.key !== 'Enter') return

    const firstResultEl = searchResultsEl.querySelector('.canvas-search-result')
    if (firstResultEl !== null) firstResultEl.click()
  })

  // In the capture phase, as a press on a card's title row goes no further.
  wrapperEl.addEventListener(
    'pointerdown',
    event => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('.canvas-search') !== null) return
      searchResultsEl.hidden = true
    },
    true,
  )
  // The wheel scrolls a long list, rather than moving the board under it.
  searchResultsEl.addEventListener('wheel', event => event.stopPropagation())
}

// ------------------------------------------------------------------- drawing

/** An SVG layer, the board's or the previews', keeps a margin around the nodes so bowed edges are not clipped. */
function resizeEdgeLayer(bounds, layerEl = edgesEl) {
  const layerX = bounds.minX - EDGE_LAYER_MARGIN
  const layerY = bounds.minY - EDGE_LAYER_MARGIN
  const layerWidth = bounds.maxX - bounds.minX + EDGE_LAYER_MARGIN * 2
  const layerHeight = bounds.maxY - bounds.minY + EDGE_LAYER_MARGIN * 2

  layerEl.style.left = `${layerX}px`
  layerEl.style.top = `${layerY}px`
  layerEl.setAttribute('width', layerWidth)
  layerEl.setAttribute('height', layerHeight)
  layerEl.setAttribute('viewBox', `${layerX} ${layerY} ${layerWidth} ${layerHeight}`)
}

/** Lists the edge under both its endpoints, so a moved node finds what to re-route. */
function indexEdge(record) {
  for (const node of [record.fromNode, record.toNode]) {
    const attached = layout.edgesByNode.get(node.id)
    if (attached) attached.push(record)
    else layout.edgesByNode.set(node.id, [record])
  }
}

function isJsonObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Throws when an optional field holds anything but a string, naming its owner
 * and the field. A field set to null is drawn as one left out.
 */
function validateOptionalString(name, record, field) {
  const value = record[field]
  if (value === undefined || value === null) return
  if (typeof value !== 'string') throw new TypeError(`${name} needs a string in "${field}"`)
}

/** The string field each node type draws from, as JSON Canvas names it. */
const CONTENT_FIELDS = new Map([['text', 'text'], ['file', 'file'], ['link', 'url']])

/**
 * Throws when a node lacks a field that drawing reads, or holds one of the
 * wrong type, naming the node and the field.
 */
function validateNode(node, index) {
  if (!isJsonObject(node)) throw new TypeError(`node ${index} is not a JSON object`)
  if (typeof node.id !== 'string') throw new TypeError(`node ${index} needs a string in "id"`)

  const name = `node "${node.id}"`
  if (typeof node.type !== 'string') throw new TypeError(`${name} needs a string in "type"`)
  for (const field of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(node[field])) throw new TypeError(`${name} needs a number in "${field}"`)
  }
  validateOptionalString(name, node, 'color')
  if (node.type === 'file') validateOptionalString(name, node, 'subpath')
  if (node.type === 'group') {
    validateOptionalString(name, node, 'label')
    validateOptionalString(name, node, 'background')
  }

  const contentField = CONTENT_FIELDS.get(node.type)
  if (contentField === undefined) return
  if (typeof node[contentField] !== 'string') throw new TypeError(`${name} needs a string in "${contentField}"`)
}

/**
 * Throws when an edge holds a field that drawing cannot read, naming the edge
 * and the field. An edge to a card the board lacks is no error: drawCanvas
 * leaves it out.
 */
function validateEdge(edge, index) {
  if (!isJsonObject(edge)) throw new TypeError(`edge ${index} is not a JSON object`)

  const name = typeof edge.id === 'string' ? `edge "${edge.id}"` : `edge ${index}`
  for (const field of ['fromSide', 'toSide']) {
    const side = edge[field]
    if (side === undefined || side === null) continue
    const isSide = Object.keys(SIDE_NORMALS).includes(side)
    if (!isSide) throw new TypeError(`${name} needs top, right, bottom or left in "${field}"`)
  }
  validateOptionalString(name, edge, 'color')
  validateOptionalString(name, edge, 'label')
}

function drawCanvas(data) {
  if (!isJsonObject(data)) throw new TypeError('canvas file is not a JSON object')

  // JSON Canvas makes both arrays optional, so `{}` is an empty board.
  const nodes = data.nodes ?? []
  if (!Array.isArray(nodes)) throw new TypeError('canvas file has a "nodes" field that is not an array')
  const edges = data.edges ?? []
  if (!Array.isArray(edges)) throw new TypeError('canvas file has an "edges" field that is not an array')

  // Every check runs before anything is drawn, so a broken file draws nothing.
  const nodesById = new Map()
  for (const [index, node] of nodes.entries()) {
    validateNode(node, index)
    if (nodesById.has(node.id)) throw new TypeError(`two nodes have the id "${node.id}"`)
    nodesById.set(node.id, node)
  }
  for (const [index, edge] of edges.entries()) {
    validateEdge(edge, index)
  }

  layout.nodes = nodes
  for (const node of nodes) {
    layout.authoredSizes.set(node.id, { width: node.width, height: node.height })
  }

  // Groups first so they sit behind; within each class the file order is the z-order.
  const groups = nodes.filter(node => node.type === 'group')
  const others = nodes.filter(node => node.type !== 'group')
  for (const node of groups.concat(others)) {
    const el = createNodeElement(node)
    layout.elements.set(node.id, el)
    installNodeDrag(node, el)
    installNodeResize(node, el)
    observeCardSize(el, node)
    canvasEl.appendChild(el)
  }
  // A card draws what it holds once it comes into view: see fillCardsInView.
  for (const node of others) unfilledNodes.add(node)

  readCardSizes()
  resizeEdgeLayer(contentBounds(nodes))

  for (const edge of edges) {
    const fromNode = nodesById.get(edge.fromNode)
    const toNode = nodesById.get(edge.toNode)
    if (!fromNode || !toNode) {
      console.warn(`edge ${edge.id} references a missing node`, edge)
      continue
    }

    const record = createEdgeElements(edge, fromNode, toNode)
    layoutEdge(record)
    edgesEl.appendChild(record.group)
    indexEdge(record)
  }

  // In and Out tell from the edges whether the card has a neighbour to show.
  for (const node of nodes) installNodeButtons(node)
}

// ----------------------------------------------------------------- bootstrap

function showStatus(message) {
  statusEl.textContent = message
  statusEl.hidden = false
}

/** The file the file view shows, as `{ path, mode }`, or null while the view is closed. */
let shownFile = null

/**
 * Shows one note on its own, either rendered for reading (`note`) or as its
 * markdown source (`raw`), with a link across to the other one. Over a board,
 * the view keeps the board out of reach until its back button closes it.
 *
 * The bytes are read here rather than by linking straight at the `.md`, because
 * hosts disagree on the media type they give markdown — GitHub Pages, nginx and
 * Python's `http.server` all send it without a charset, and the browser then
 * decodes UTF-8 as Latin-1. `Response.text()` always decodes as UTF-8, whatever
 * the response header claims.
 */
async function showFileView(path, mode) {
  const isRaw = mode === 'raw'
  const file = { path: path, mode: mode }
  shownFile = file
  // A link in the preview that opens a file takes the reader on from the preview.
  closeCardPreview()

  if (config.ownsPage) document.title = path
  fileViewPathEl.textContent = path
  fileViewToggleEl.href = isRaw ? noteHref(path) : rawHref(path)
  fileViewToggleEl.textContent = isRaw ? 'Rendered' : 'Source'
  const coversBoard = hostEl.dataset.mode !== 'file'
  fileViewBackEl.hidden = !coversBoard
  wrapperEl.inert = coversBoard
  fileViewBodyEl.replaceChildren()
  fileViewEl.scrollTop = 0
  fileViewEl.hidden = false

  const url = encodePath(path)
  const response = await fetchFile(url, path)
  const text = await response.text()
  // The view may have closed, or moved on to another file, while this one loaded.
  if (shownFile !== file) return

  if (!isRaw) {
    fileViewBodyEl.replaceChildren(markdownElement(renderMarkdown(text), path))
    return
  }

  const sourceEl = document.createElement('pre')
  sourceEl.className = 'file-view-source'
  sourceEl.textContent = text
  fileViewBodyEl.replaceChildren(sourceEl)
}

/** Shows a file in the view, and a file that cannot be read says why there. */
function openFile(path, mode) {
  const shown = showFileView(path, mode)
  // showFileView records the file before its first await.
  const file = shownFile
  shown.catch(error => {
    if (shownFile !== file) return
    fileViewBodyEl.replaceChildren(placeholderElement(error.message))
  })
}

/** Closes the view over the board, and gives the board back to the reader. */
function closeFileView() {
  shownFile = null
  fileViewEl.hidden = true
  wrapperEl.inert = false
}

/**
 * On a board mounted in another page, a plain click on a link to a file runs
 * `show`, which shows the file inside the board. The link itself opens the
 * renderer's own page, which may sit on another site and then cannot read the
 * files of this one. A click with a modifier key still opens the link.
 */
function showOnPlainClick(linkEl, show) {
  if (config.ownsPage) return

  linkEl.addEventListener('click', event => {
    if (event.defaultPrevented) return
    const hasModifier = event.metaKey || event.ctrlKey || event.shiftKey
    if (hasModifier) return

    event.preventDefault()
    show()
  })
}

/** The back button returns to the board; the toggle shows the file's other form. */
function installFileView() {
  fileViewBackEl.addEventListener('click', closeFileView)
  showOnPlainClick(fileViewToggleEl, () => {
    const mode = shownFile.mode === 'raw' ? 'note' : 'raw'
    openFile(shownFile.path, mode)
  })
}

async function main(params) {
  installThemeToggles()
  installFileView()
  startMarkdown({ marked, katex, DOMPurify })

  for (const mode of ['note', 'raw']) {
    const path = params.get(mode)
    if (path === null) continue
    assertAllowedHost(path, mode)
    config.vaultRoot = resolveVaultRoot(params, path)
    config.attachments = resolveAttachments(params)
    hostEl.dataset.mode = 'file'
    await showFileView(path, mode)
    return
  }

  const canvasPath = params.get('canvas') || DEFAULT_CANVAS_PATH
  assertAllowedHost(canvasPath, 'canvas')
  config.canvasPath = canvasPath
  config.vaultRoot = resolveVaultRoot(params, canvasPath)
  config.attachments = resolveAttachments(params)
  config.cardSize = preferredCardSize(params)
  const centre = requestedCentre(params)
  applyTextScale(requestedTextScale(params))
  config.historyLength = requestedHistoryLength(params)

  showStatus(`Loading ${canvasPath} …`)
  const response = await fetchFile(encodePath(canvasPath), canvasPath)

  const data = await response.json().catch(cause => {
    throw new Error(`Cannot parse ${canvasPath}: ${cause.message}`, { cause: cause })
  })
  statusEl.hidden = true

  drawCanvas(data)
  fitToContent(contentBounds(layout.nodes))
  // A link that names a view opens on it in place of the fit, `focus` over `at`.
  if (centre !== null) centreView(centre)
  const focusId = params.get('focus')
  if (focusId !== null) showRequestedCard(focusId)
  installViewportControls()
  installCardSizeControl()
  installSearch()
  installGridSnapControl()
  installEnlargeKey()
  installEscapeKey()
  installCardPreview()
  installFocusHistory()
  installMarginTitles()
}

/** Appends `el`, a `<link>` or a `<script>`, to `parent`, and resolves once the file at `url` has loaded. */
function appendLoaded(parent, el, url) {
  const loaded = new Promise((resolve, reject) => {
    el.addEventListener('load', resolve)
    el.addEventListener('error', () => reject(new Error(`Cannot load ${url}`)))
  })
  parent.append(el)
  return loaded
}

function linkStylesheet(parent, path) {
  const linkEl = document.createElement('link')
  linkEl.rel = 'stylesheet'
  linkEl.href = new URL(path, APP_URL).href
  return appendLoaded(parent, linkEl, linkEl.href)
}

/** Runs a library as a classic script, which defines the library's global. */
function loadLibrary(path) {
  const scriptEl = document.createElement('script')
  scriptEl.src = new URL(path, APP_URL).href
  return appendLoaded(document.head, scriptEl, scriptEl.src)
}

/**
 * Links the board's stylesheets into its shadow root, and loads each library
 * the page has not. A shadow root ignores `@font-face`, so KaTeX's stylesheet
 * goes into the page's head as well, to declare its fonts.
 */
function loadAssets(shadowRoot) {
  const loads = [linkStylesheet(document.head, KATEX_STYLESHEET)]
  for (const path of BOARD_STYLESHEETS) loads.push(linkStylesheet(shadowRoot, path))
  for (const [name, path] of LIBRARIES) {
    if (name in window) continue
    loads.push(loadLibrary(path))
  }
  return Promise.all(loads)
}

/**
 * Draws a board inside `el`, in a shadow root, which keeps the page's styles
 * and the board's apart. A page shows one board.
 *
 * Without `params`, the board is the whole page: it reads the parameters from
 * the page's address and keeps its view there. With `params`, anything
 * `URLSearchParams` takes, such as `{ canvas: 'boards/raft.canvas' }`, it
 * reads those, and leaves the page's address and title alone. Either way, a
 * relative path is relative to the page's address.
 *
 * Resolves once the board is drawn. A board that cannot be drawn shows why,
 * and the promise rejects.
 */
export async function mount(el, params) {
  if (!(el instanceof Element)) throw new TypeError(`mount draws a board in an element, got ${el}`)
  if (hostEl !== null) throw new Error('mount draws one board per page, and this page has one')
  const shadowRoot = el.attachShadow({ mode: 'open' })
  hostEl = el
  config.ownsPage = params === undefined
  const query = config.ownsPage ? window.location.search : params
  try {
    await loadAssets(shadowRoot)
    shadowRoot.append(boardFragment)
    await main(new URLSearchParams(query))
  } catch (error) {
    // The markup waits for its stylesheets, so a failed load has left it out.
    shadowRoot.append(boardFragment)
    showStatus(String(error.message || error))
    throw error
  }
}
