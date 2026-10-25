/**
 * Moving and resizing cards by hand: a drag on a card's title, or anywhere on a
 * group, carries it, and the grip in a card's corner resizes it. With the grid
 * on, both land on the grid.
 */

import { contentBounds } from './geometry.js'

export const GRID_SIZE = 20
const GRID_SNAP_STORAGE_KEY = 'canvas-render-grid-snap'
const MIN_CARD_WIDTH = 120
const MIN_CARD_HEIGHT = 60

/** The grid line nearest a canvas coordinate. */
function nearestGridLine(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

/**
 * One board's dragging. `config` says whether the grid is on, `view` gives the
 * zoom, and `model` the cards a group carries. `actions` move and size a card
 * through the layout, fit the edge layer to the board, free the view from its
 * fit, and tell a press on a control from a press on a card.
 */
export function createDragging(gridSnapEl, config, view, model, actions) {
  const { placeNode, sizeNode, resizeEdgeLayer, releaseAutoFit, isInteractiveTarget } = actions

  /**
   * What a press on this node moves. Obsidian carries a group's contents with the
   * frame, and the file format records no membership, so a group takes every node
   * whose box lies inside its own — fixed when the drag starts, so a node the
   * frame merely passes over is not picked up along the way.
   */
  function movedNodes(node) {
    if (node.type !== 'group') return [node]

    const contained = model.nodes.filter(other => {
      if (other === node) return false
      const insideX = other.x >= node.x && other.x + other.width <= node.x + node.width
      const insideY = other.y >= node.y && other.y + other.height <= node.y + node.height
      return insideX && insideY
    })
    return [node].concat(contained)
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
      resizeEdgeLayer(contentBounds(model.nodes))
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
      resizeEdgeLayer(contentBounds(model.nodes))
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

  return { installGridSnapControl, installNodeDrag, installNodeResize }
}
