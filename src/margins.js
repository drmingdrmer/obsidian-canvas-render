/**
 * The titles in the margin: a card out of view that an edge joins to the
 * focused card shows its title along the side of the viewport where that edge
 * leaves the view.
 */

import {
  SIDE_NORMALS, edgeGeometry, bezierPoint, meetsRect, sideBeyond, lastExit, freeStretches, nearestFit,
} from './geometry.js'
import { resolveColor } from './cards.js'
import { cardName, edgeSides } from './model.js'

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

/** Points a title's arrow out of its side of the viewport, in the colour of the edge it stands for. */
function markMarginTitle(title) {
  const { el, record, side } = title
  el.dataset.side = side
  const color = resolveColor(record.edge.color)
  if (color) el.style.setProperty('--edge-color', color)
  else el.style.removeProperty('--edge-color')
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
 * One board's margin titles, drawn in `marginEl`. They follow the size of the
 * board's wrapper, and keep clear of the controls and the history. `view`
 * places them, `model` gives the cards and their edges, and `layout` the
 * element each card is drawn as. `actions` tell which card holds the focus,
 * and fly the view to a card.
 */
export function createMargins({ wrapperEl, marginEl, historyEl, controlsEl }, view, model, layout, actions) {
  const { focusedCard, flyToCard } = actions

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

  return { scheduleMarginTitles, viewRect, installMarginTitles }
}
