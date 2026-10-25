/**
 * Where a board draws its canvas: an element for each card, the edges between
 * them, the size each card is drawn at, and what each card holds once it is in
 * view.
 */

import { edgeGeometry, arrowPoints, bezierPoint, contentBounds, meetsRect } from './geometry.js'
import { SVG_NAMESPACE } from './elements.js'
import { resolveColor, holdsEmbed } from './cards.js'
import { indexEdge, edgeSides } from './model.js'

export const CARD_SIZE_STORAGE_KEY = 'canvas-render-card-size'

/**
 * What the card-size control offers, one button each. `actual` draws every card
 * at the size its file gives it. The other two ignore that size, fix one width
 * for the whole board and let the content set the height, up to a cap that
 * keeps a long note from towering over the rest.
 */
export const CARD_SIZES = {
  actual: { width: null, maxHeight: null },
  wide: { width: 520, maxHeight: 480 },
  compact: { width: 320, maxHeight: 240 },
}

/**
 * A card draws what it holds once it is in view on a board drawn at
 * CONTENT_MIN_ZOOM or more. Below that its text is too small to read, so a
 * board zoomed out to fit shows each card's title alone, and loads no note.
 * Text drawn larger than its own size makes up for a smaller zoom.
 */
const CONTENT_MIN_ZOOM = 0.5

/** Extra room around the node bounding box so bowed edges are not clipped. */
const EDGE_LAYER_MARGIN = 400

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
export function createEdgeElements(edge, fromNode, toNode) {
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

/** Writes the geometry the endpoints' current positions imply into an existing edge. */
export function layoutEdge(record) {
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

/**
 * One board's layout. It draws the canvas `model` holds in the elements `els`
 * names, and `cards` fills each card. It reads the card size and the text size
 * from `config`, and the zoom from `view`. `actions` keep the rest of the board
 * in step: the previews and the margin titles follow the edges, the enlarged
 * card is placed again or put back, and the view refits.
 */
export function createLayout(els, config, view, model, cards, actions) {
  const { wrapperEl, canvasEl, edgesEl, cardSizeEls } = els
  const { fillNodeElement, fillNodeContent } = cards
  const {
    viewRect, layoutChanged, enlargedCard, placeEnlargedCard, restoreEnlargedCard,
    refitView, fitToContent,
  } = actions

  /**
   * The drawn canvas: the element each node was drawn as, the edges on it, and
   * the sizes the file authored — which the node data no longer holds once a
   * card is drawn at a size of its own.
   */
  const layout = { elements: new Map(), edgesByNode: new Map(), authoredSizes: new Map() }

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

  /** Draws what every card on the board holds, in view or not. */
  function fillAllCards() {
    for (const node of unfilledNodes) fillCard(node)
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
    layoutChanged()
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
    for (const node of model.nodes) recordCardSize(node)
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
    layoutChanged()

    const bounds = contentBounds(model.nodes)
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
      if (entry.target === enlargedCard()) {
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

    for (const node of model.nodes) applyNodeSize(layout.elements.get(node.id), node)
    readCardSizes()
    const bounds = relayoutAfterResize(model.nodes)
    fitToContent(bounds)
  }

  function installCardSizeControl() {
    markCardSizeControl(config.cardSize)
    for (const el of cardSizeEls) {
      // Pressing the size already in force puts cards resized by hand back under it.
      el.addEventListener('click', () => applyCardSize(el.dataset.cardSize))
    }
  }

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

  /** Draws the cards of the canvas the model holds, and measures them. */
  function drawCards() {
    const nodes = model.nodes
    for (const node of nodes) {
      layout.authoredSizes.set(node.id, { width: node.width, height: node.height })
    }

    // Groups first so they sit behind; within each class the file order is the z-order.
    const groups = nodes.filter(node => node.type === 'group')
    const others = nodes.filter(node => node.type !== 'group')
    for (const node of groups.concat(others)) {
      const el = createNodeElement(node)
      layout.elements.set(node.id, el)
      observeCardSize(el, node)
      canvasEl.appendChild(el)
    }
    // A card draws what it holds once it comes into view: see fillCardsInView.
    for (const node of others) unfilledNodes.add(node)

    readCardSizes()
    resizeEdgeLayer(contentBounds(nodes))
  }

  /** Draws each edge between two cards, routed between the boxes the cards were measured at. */
  function drawEdges(records) {
    for (const { edge, fromNode, toNode } of records) {
      const record = createEdgeElements(edge, fromNode, toNode)
      layoutEdge(record)
      edgesEl.appendChild(record.group)
      indexEdge(layout.edgesByNode, record)
    }
  }

  return {
    layout, observedNodes, fillAllCards, fillCard, scheduleFillCards, placeNode, sizeNode, installCardSizeControl,
    resizeEdgeLayer, drawCards, drawEdges,
  }
}
