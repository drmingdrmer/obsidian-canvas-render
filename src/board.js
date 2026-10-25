/**
 * One board: the cards and edges of a canvas in a pan/zoom viewport, the
 * controls over them, and the views that read its notes.
 */

import {
  SIDE_NORMALS, sideAnchor, inferSide, edgeGeometry, bezierPoint, contentBounds,
  meetsRect, sideBeyond, lastExit, freeStretches, nearestFit,
} from './geometry.js'
import { encodePath, fetchFile, createResources } from './resources.js'
import { createElements, createIcon, placeholderElement } from './elements.js'
import { createMarkdown } from './markdown.js'
import { resolveColor, nodeTitleText, holdsEmbed, createCardRenderer } from './cards.js'
import { edgeSides, cardName, createModel } from './model.js'
import { CARD_SIZES, createEdgeElements, layoutEdge, createLayout } from './layout.js'
import { createDragging } from './dragging.js'
import { isInteractiveTarget, createViewport } from './viewport.js'
import {
  DEFAULT_HISTORY_LENGTH, requestedCentre, requestedTextScale, preferredCardSize, requestedHistoryLength, createPage,
} from './page.js'

// ---------------------------------------------------------------- constants

const DEFAULT_CANVAS_PATH = 'vault/demo.canvas'
const HISTORY_STORAGE_KEY = 'canvas-render-history'

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
    layout, observedNodes, unfilledNodes, fillCard, scheduleFillCards, placeNode, sizeNode, installCardSizeControl,
    resizeEdgeLayer, drawCards, drawEdges,
  } = createLayout({ wrapperEl, canvasEl, edgesEl, cardSizeEls }, config, view, model, cards, {
    viewRect, placeNeighbours, scheduleMarginTitles, enlargedCard: () => enlargedCardEl, placeEnlargedCard,
    restoreEnlargedCard, refitView, fitToContent,
  })

  /** Moving and resizing cards by hand. */
  const dragging = createDragging(gridSnapEl, config, view, model, {
    placeNode, sizeNode, resizeEdgeLayer, releaseAutoFit, isInteractiveTarget,
  })
  const { installGridSnapControl, installNodeDrag, installNodeResize } = dragging

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

  /** A wheel scrolls a card's content only over the card the focus is on. */
  function wheelScrollsCard(target) {
    if (focusedCardEl === null) return false
    if (!(target instanceof Element)) return false

    const contentEl = target.closest('.canvas-node-content')
    if (contentEl === null) return false
    return contentEl.closest('.canvas-node') === focusedCardEl
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

  /**
   * Puts a card that takes the focus first in the history. The list is drawn
   * again either way: its mark follows the focus, and goes when the focus moves
   * to the board.
   */
  function recordFocus(cardEl) {
    if (cardEl !== null) {
      const node = model.nodes.find(node => layout.elements.get(node.id) === cardEl)
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

  // -------------------------------------------------------------------- search

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
    for (const node of model.nodes) {
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

    setPageTitle(path)
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
