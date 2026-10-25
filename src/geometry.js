/**
 * The board's geometry: the curve an edge follows, the path a flight takes,
 * and where a point, a box or a stretch lies. Each function reads only its
 * arguments, and none touches an element.
 */

export const SIDE_NORMALS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

const EDGE_MIN_CONTROL_OFFSET = 24
const EDGE_CONTROL_RATIO = 0.35
const ARROW_LENGTH = 13
const ARROW_HALF_WIDTH = 7

/** FLIGHT_RHO, the ρ of van Wijk and Nuij's flight path, sets how far out a flight goes. */
const FLIGHT_RHO = Math.SQRT2

/**
 * The place where an edge leaves the view is found among EDGE_EXIT_SAMPLES
 * points along the edge, then narrowed down by EDGE_EXIT_HALVINGS halvings.
 */
const EDGE_EXIT_SAMPLES = 32
const EDGE_EXIT_HALVINGS = 10

export function sideAnchor(node, side) {
  if (side === 'top') return { x: node.x + node.width / 2, y: node.y }
  if (side === 'bottom') return { x: node.x + node.width / 2, y: node.y + node.height }
  if (side === 'left') return { x: node.x, y: node.y + node.height / 2 }
  return { x: node.x + node.width, y: node.y + node.height / 2 }
}

/** JSON Canvas allows omitting a side; pick the one facing the other node. */
export function inferSide(node, other) {
  const dx = other.x + other.width / 2 - (node.x + node.width / 2)
  const dy = other.y + other.height / 2 - (node.y + node.height / 2)
  const isHorizontal = Math.abs(dx) >= Math.abs(dy)

  if (isHorizontal) {
    const towardsRight = dx >= 0
    return towardsRight ? 'right' : 'left'
  }

  const towardsBottom = dy >= 0
  return towardsBottom ? 'bottom' : 'top'
}

/**
 * Cubic bezier whose control points leave each anchor along that side's outward
 * normal — this is what gives Obsidian edges their characteristic S shape.
 */
export function edgeGeometry(fromNode, fromSide, toNode, toSide) {
  const start = sideAnchor(fromNode, fromSide)
  const end = sideAnchor(toNode, toSide)
  const startNormal = SIDE_NORMALS[fromSide]
  const endNormal = SIDE_NORMALS[toSide]

  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const offset = Math.max(EDGE_MIN_CONTROL_OFFSET, distance * EDGE_CONTROL_RATIO)

  const startControl = { x: start.x + startNormal.x * offset, y: start.y + startNormal.y * offset }
  const endControl = { x: end.x + endNormal.x * offset, y: end.y + endNormal.y * offset }

  return { start, startControl, endControl, end, startNormal, endNormal }
}

/** The point of an edge's curve at `t`, which runs from 0 at the curve's start to 1 at its end. */
export function bezierPoint(geometry, t) {
  const { start, startControl, endControl, end } = geometry
  const rest = 1 - t
  // The Bernstein weights of the curve's four points.
  const weights = [rest * rest * rest, 3 * rest * rest * t, 3 * rest * t * t, t * t * t]
  const points = [start, startControl, endControl, end]
  let x = 0
  let y = 0
  for (const [index, point] of points.entries()) {
    x += weights[index] * point.x
    y += weights[index] * point.y
  }
  return { x, y }
}

/** Triangle with its tip on the node border, pointing inwards. */
export function arrowPoints(tip, outwardNormal) {
  const baseX = tip.x + outwardNormal.x * ARROW_LENGTH
  const baseY = tip.y + outwardNormal.y * ARROW_LENGTH
  const perpX = -outwardNormal.y * ARROW_HALF_WIDTH
  const perpY = outwardNormal.x * ARROW_HALF_WIDTH
  return `${tip.x},${tip.y} ${baseX + perpX},${baseY + perpY} ${baseX - perpX},${baseY - perpY}`
}

export function contentBounds(nodes) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }

  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY }
}

/**
 * A view as `flightPath` takes it: the canvas point at the viewport's centre,
 * and the width of canvas that `viewport.size` screen pixels span.
 */
export function viewSpan(at, viewport) {
  const x = (viewport.centreX - at.x) / at.zoom
  const y = (viewport.centreY - at.y) / at.zoom
  const width = viewport.size / at.zoom
  return { x, y, width }
}

/**
 * The path from one view to another, each a `viewSpan`, as van Wijk and Nuij
 * give it and d3's `interpolateZoom` writes it. `at(t)` is the view a fraction
 * `t` of the way along, and `length` is how long the path is.
 */
export function flightPath(from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  const rho2 = FLIGHT_RHO * FLIGHT_RHO

  // Two views of one point differ in their zoom alone.
  if (distance < 1e-6) {
    const zoomLength = Math.log(to.width / from.width) / FLIGHT_RHO
    const atPoint = t => {
      const width = from.width * Math.exp(FLIGHT_RHO * t * zoomLength)
      return { x: from.x + t * dx, y: from.y + t * dy, width }
    }
    return { at: atPoint, length: Math.abs(zoomLength) }
  }

  const widthGap = to.width * to.width - from.width * from.width
  const panTerm = rho2 * rho2 * distance * distance
  const b0 = (widthGap + panTerm) / (2 * from.width * rho2 * distance)
  const b1 = (widthGap - panTerm) / (2 * to.width * rho2 * distance)
  const r0 = -Math.asinh(b0)
  const r1 = -Math.asinh(b1)
  const length = (r1 - r0) / FLIGHT_RHO
  const at = t => {
    const r = FLIGHT_RHO * t * length + r0
    const swing = Math.cosh(r0) * Math.tanh(r) - Math.sinh(r0)
    const along = from.width / (rho2 * distance) * swing
    const width = from.width * Math.cosh(r0) / Math.cosh(r)
    return { x: from.x + along * dx, y: from.y + along * dy, width }
  }
  return { at, length }
}

/** Starts slow, speeds up, and slows down again to land: d3's cubic in-out. */
export function easeInOut(t) {
  if (t < 0.5) return 4 * t * t * t
  const rest = 2 - 2 * t
  return 1 - rest * rest * rest / 2
}

/** True when some of the node's box lies inside the rect, not only on its border. */
export function meetsRect(node, rect) {
  const meetsX = node.x < rect.maxX && node.x + node.width > rect.minX
  const meetsY = node.y < rect.maxY && node.y + node.height > rect.minY
  return meetsX && meetsY
}

/** True when the point lies inside the rect, not on its border. */
function holdsPoint(rect, point) {
  const holdsX = point.x > rect.minX && point.x < rect.maxX
  const holdsY = point.y > rect.minY && point.y < rect.maxY
  return holdsX && holdsY
}

/** The side of the rect that a point outside it lies farthest beyond. */
export function sideBeyond(rect, point) {
  const distances = {
    top: rect.minY - point.y,
    right: point.x - rect.maxX,
    bottom: point.y - rect.maxY,
    left: rect.minX - point.x,
  }
  let side = 'top'
  for (const [name, distance] of Object.entries(distances)) {
    if (distance > distances[side]) side = name
  }
  return side
}

/**
 * The `t` at which a path leaves the rect for the last time, or null for a
 * path that never runs inside the rect. `pointAt` gives the path's point at
 * each `t`, from 0 at its start to 1 at its end.
 */
export function lastExit(pointAt, rect) {
  let lastInside = -1
  for (let step = 0; step <= EDGE_EXIT_SAMPLES; step++) {
    const point = pointAt(step / EDGE_EXIT_SAMPLES)
    if (holdsPoint(rect, point)) lastInside = step
  }
  if (lastInside === -1) return null

  // The path crosses the border between the last point inside and the next one.
  let inside = lastInside / EDGE_EXIT_SAMPLES
  let outside = (lastInside + 1) / EDGE_EXIT_SAMPLES
  for (let halving = 0; halving < EDGE_EXIT_HALVINGS; halving++) {
    const middle = (inside + outside) / 2
    const point = pointAt(middle)
    if (holdsPoint(rect, point)) inside = middle
    else outside = middle
  }
  return outside
}

/** The parts of the range, `{ start, end }`, that none of the taken stretches covers, in order. */
export function freeStretches(range, taken) {
  const sorted = [...taken]
  sorted.sort((a, b) => a.start - b.start)
  const free = []
  let cursor = range.start
  for (const stretch of sorted) {
    if (stretch.start >= range.end) break
    if (stretch.start > cursor) free.push({ start: cursor, end: stretch.start })
    cursor = Math.max(cursor, stretch.end)
  }
  if (cursor < range.end) free.push({ start: cursor, end: range.end })
  return free
}

/**
 * The start nearest to `wanted` at which something `length` long fits into one
 * of the free stretches, or null when none of them is long enough. Of two
 * starts as near, the later one wins.
 */
export function nearestFit(wanted, length, free) {
  let best = null
  for (const stretch of free) {
    if (stretch.end - stretch.start < length) continue
    const start = Math.min(Math.max(wanted, stretch.start), stretch.end - length)
    const isNearer = best === null || Math.abs(start - wanted) <= Math.abs(best - wanted)
    if (isNearer) best = start
  }
  return best
}
