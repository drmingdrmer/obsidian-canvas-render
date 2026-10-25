/**
 * The previews of a card's neighbours: In and Out on the focused card show,
 * around it, the cards its dependency edges come from or lead to, each joined
 * to it by a copy of its edge.
 */

import { SIDE_NORMALS, sideAnchor, inferSide, contentBounds } from './geometry.js'
import { createIcon } from './elements.js'
import { CARD_SIZES, createEdgeElements, layoutEdge } from './layout.js'

/**
 * In and Out preview a card's neighbours around it, each cut to the size of a
 * card in Compact at most. The previews stand NEIGHBOUR_DISTANCE clear of the
 * card, which leaves room for the edges between them, and NEIGHBOUR_GAP clear
 * of each other.
 */
const NEIGHBOUR_SIZE = CARD_SIZES.compact
const NEIGHBOUR_DISTANCE = 80
const NEIGHBOUR_GAP = 20

const OPPOSITE_SIDES = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }

/** In and Out, keyed by the direction of the dependency edges whose cards they preview. */
const NEIGHBOUR_BUTTONS = {
  in: { label: 'In', title: 'Show the cards to read before this one' },
  out: { label: 'Out', title: 'Show the cards to read after this one' },
}

/** lucide `locate-fixed`: the button finds the card on the board. */
const LOCATE_ICON =
  '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/>' +
  '<line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/>' +
  '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>'

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
 * One board's neighbour previews. `els` are the layer the previews stand in
 * and the layer of their copied edges, and `layout` gives the element each
 * card is drawn as. `actions` find a card's neighbours, draw a preview as the
 * board draws its card, fit the edge layer to the previews, and fly the view
 * to a card.
 */
export function createNeighbours(els, layout, actions) {
  const { neighboursEl, neighbourLinksEl } = els
  const { findNeighbours, fillNodeElement, fillNodeContent, resizeEdgeLayer, flyToCard } = actions

  /** The directions In and Out preview the focused card's neighbours in: `in`, `out`, both or neither. */
  const shownDirections = new Set()

  /** The focused card while In or Out shows its previews, or null. */
  let surroundedNode = null

  /** The previews on the board, each `{ node, record, direction, el, box, link, side }`. */
  let neighbourPreviews = []

  /**
   * A card's In and Out: In on its left side and Out on its right side, where
   * the dependency edges enter and leave it. In, or Out, is greyed out on a card
   * that no dependency edge leads into, or out of.
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

  return { installNodeButtons, hideNeighbours, placeNeighbours }
}
