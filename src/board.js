/**
 * One board: the cards and edges of a canvas in a pan/zoom viewport, the
 * controls over them, and the views that read its notes.
 */

import {
  SIDE_NORMALS, sideAnchor, inferSide, edgeGeometry, bezierPoint, contentBounds,
  meetsRect, sideBeyond, lastExit, freeStretches, nearestFit,
} from './geometry.js'
import { encodePath, fetchFile, createResources } from './resources.js'
import { createElements, createIcon } from './elements.js'
import { createMarkdown } from './markdown.js'
import { resolveColor, createCardRenderer } from './cards.js'
import { edgeSides, cardName, createModel } from './model.js'
import { CARD_SIZES, createEdgeElements, layoutEdge, createLayout } from './layout.js'
import { createDragging } from './dragging.js'
import { isInteractiveTarget, createViewport } from './viewport.js'
import {
  DEFAULT_HISTORY_LENGTH, requestedCentre, requestedTextScale, preferredCardSize, requestedHistoryLength, createPage,
} from './page.js'
import { createNavigation } from './navigation.js'
import { createReading } from './reading.js'

// ---------------------------------------------------------------- constants

const DEFAULT_CANVAS_PATH = 'vault/demo.canvas'

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

const OPPOSITE_SIDES = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }

/**
 * Builds a board in `hostEl`, the element `mount` draws it in, which carries
 * the theme and the view mode. `ownsPage` is false for a board mounted in
 * another page; `appUrl` is the folder of the renderer's own page; and
 * `remoteHosts` are the hosts besides this page's own that the board reads
 * from. `main` draws a canvas on the board once marked, KaTeX and DOMPurify
 * have loaded, and `showStatus` says why the board could not be drawn.
 */
export function createBoard(hostEl, ownsPage, appUrl, remoteHosts) {
  // ------------------------------------------------------------------ elements

  const {
    boardFragment, wrapperEl, backgroundEl, canvasEl, edgesEl, neighboursEl, neighbourLinksEl, marginEl, statusEl,
    controlsEl, zoomInEl, zoomOutEl, zoomResetEl, zoomFitEl, textSmallerEl, textResetEl, textLargerEl, cardSizeEls,
    gridSnapEl, historyToggleEl, historyEl, historyListEl, searchEl, searchResultsEl, themeToggleEls, fileViewEl,
    fileViewBackEl, fileViewPathEl, fileViewToggleEl, fileViewBodyEl, cardPreviewEl, cardPreviewTitleEl,
    cardPreviewGoEl, cardPreviewCloseEl, cardPreviewBodyEl,
  } = createElements()

  // --------------------------------------------------------------------- state

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
    ownsPage: ownsPage,
  }

  /** The canvas the board draws: its nodes, and the edges between two of them. */
  const { model, loadCanvas, linkedCard, findNeighbours } = createModel()

  /** The part of the board in view, and the controls that pan, zoom and fit it, and size its text. */
  const viewportEls = {
    wrapperEl, canvasEl, backgroundEl, zoomInEl, zoomOutEl, zoomResetEl, zoomFitEl, textLargerEl, textSmallerEl,
    textResetEl,
  }
  const viewport = createViewport(viewportEls, config, model, { viewChanged, focusOnPress, wheelScrollsCard })
  const {
    view, applyTextScale, fitView, fitToContent, refitView, flyView, installViewportControls, centreView,
    releaseAutoFit,
  } = viewport

  /** The theme, the title and the address bar of the page the board is on. */
  const { installThemeToggles, setPageTitle, scheduleViewUrl } =
    createPage(hostEl, themeToggleEls, config, viewport.viewSnapshot)

  /** The paths and links of the board's files, as `main` sets `config` up for them. */
  const resources = createResources(config, appUrl, remoteHosts)
  const { noteHref, rawHref, assertAllowedHost, resolveVaultRoot, resolveAttachments } = resources

  /** The board's markdown, which `main` starts once marked, KaTeX and DOMPurify have loaded. */
  const markdown = createMarkdown(resources, {
    linkedCard, showCardPreview, closeCardPreview, closeFileView, flyToCard, showOnPlainClick, openFile,
  })
  const { startMarkdown, renderMarkdown, markdownElement } = markdown

  /** What the board draws in a card, and in the card preview. */
  const cards = createCardRenderer(config, remoteHosts, resources, markdown, { showOnPlainClick, openFile })
  const { fillFileNode, fillNodeElement, fillNodeContent } = cards

  /** Where the board draws its cards and edges, and at what size. */
  const {
    layout, observedNodes, fillAllCards, fillCard, scheduleFillCards, placeNode, sizeNode, installCardSizeControl,
    resizeEdgeLayer, drawCards, drawEdges,
  } = createLayout({ wrapperEl, canvasEl, edgesEl, cardSizeEls }, config, view, model, cards, {
    viewRect, placeNeighbours, scheduleMarginTitles, enlargedCard, placeEnlargedCard,
    restoreEnlargedCard, refitView, fitToContent,
  })

  /** Moving and resizing cards by hand. */
  const dragging = createDragging(gridSnapEl, config, view, model, {
    placeNode, sizeNode, resizeEdgeLayer, releaseAutoFit, isInteractiveTarget,
  })
  const { installGridSnapControl, installNodeDrag, installNodeResize } = dragging

  /** The card the focus is on, the search, and the history of the cards the focus has been on. */
  const navigationEls = { wrapperEl, searchEl, searchResultsEl, historyEl, historyListEl, historyToggleEl }
  const navigation = createNavigation(navigationEls, config, model, layout, {
    fitToContent, fitView, flyView, fillAllCards, restoreEnlargedCard, hideNeighbours, scheduleMarginTitles,
  })
  const { focusCard, showCard, focusedCard, installFocusHistory, installSearch } = navigation

  /** The card enlarged over the board, the card preview, and the file view. */
  const readingEls = {
    hostEl, wrapperEl, controlsEl, cardPreviewEl, cardPreviewTitleEl, cardPreviewGoEl, cardPreviewCloseEl,
    cardPreviewBodyEl, fileViewEl, fileViewBackEl, fileViewPathEl, fileViewToggleEl, fileViewBodyEl,
  }
  const reading = createReading(readingEls, config, view, observedNodes, {
    fillCard, noteHref, rawHref, renderMarkdown, markdownElement, fillFileNode, focusCard, focusedCard, flyToCard,
    setPageTitle,
  })
  const {
    installNodeEnlarge, installEnlargeKey, installEscapeKey, installCardPreview, showFileView, installFileView,
  } = reading

  // ---------------------------------------------------------------- forwarding

  // Navigation and the reading views are built from the layout, after the parts
  // that call them: the viewport hands a press and a wheel to the focus, a link
  // in markdown or on a card opens a preview, a flight or the file view, and the
  // layout keeps the enlarged card in step. These reach the two once they exist.

  function focusOnPress(target) {
    navigation.focusOnPress(target)
  }

  function wheelScrollsCard(target) {
    return navigation.wheelScrollsCard(target)
  }

  function flyToCard(node) {
    navigation.flyToCard(node)
  }

  function showCardPreview(node, linkEl) {
    reading.showCardPreview(node, linkEl)
  }

  function closeCardPreview() {
    reading.closeCardPreview()
  }

  function closeFileView() {
    reading.closeFileView()
  }

  function showOnPlainClick(linkEl, show) {
    reading.showOnPlainClick(linkEl, show)
  }

  function openFile(path, mode) {
    reading.openFile(path, mode)
  }

  function enlargedCard() {
    return reading.enlargedCard()
  }

  function placeEnlargedCard() {
    reading.placeEnlargedCard()
  }

  function restoreEnlargedCard() {
    reading.restoreEnlargedCard()
  }

  // ------------------------------------------------------------------ viewport

  /**
   * A moved view, a resized window or a new text size takes along the address
   * bar, the enlarged card, the titles in the margin and the cards drawn in view.
   */
  function viewChanged() {
    scheduleViewUrl()
    placeEnlargedCard()
    scheduleMarginTitles()
    scheduleFillCards()
  }

  // --------------------------------------------------------------- address bar

  /** Fits the view to the card `focus` names, or says that the board holds no such card. */
  function showRequestedCard(id) {
    const node = model.nodes.find(node => node.id === id)
    if (node === undefined) {
      showStatus(`the focus parameter accepts the id of a card on this board, got ${id}`)
      return
    }
    showCard(node)
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
    const focusedCardEl = focusedCard()
    if (focusedCardEl === null) return []
    const node = model.nodes.find(node => layout.elements.get(node.id) === focusedCardEl)
    if (!meetsRect(node, rect)) return []

    const found = new Map()
    const attached = model.edgesByNode.get(node.id) ?? []
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

  // ------------------------------------------------------------------- drawing

  /** Draws a canvas file on the board, and gives each card its controls once the edges are drawn. */
  function drawCanvas(data) {
    const records = loadCanvas(data)
    drawCards()
    drawEdges(records)
    for (const node of model.nodes) {
      const el = layout.elements.get(node.id)
      installNodeDrag(node, el)
      installNodeResize(node, el)
      // In and Out tell from the edges whether the card has a neighbour to show.
      installNodeButtons(node)
    }
  }

  // ----------------------------------------------------------------- bootstrap

  function showStatus(message) {
    statusEl.textContent = message
    statusEl.hidden = false
  }

  async function main(params, libraries) {
    installThemeToggles()
    installFileView()
    startMarkdown(libraries)

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
    fitToContent(contentBounds(model.nodes))
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

  return { boardFragment, main, showStatus }
}
