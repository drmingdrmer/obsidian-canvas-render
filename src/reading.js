/**
 * Reading a card or a note whole: a card enlarged over the board, the preview
 * of a card that a wikilink opens, and the file view, which shows a note or
 * its source on its own.
 */

import { encodePath, fetchFile } from './resources.js'
import { createIcon, placeholderElement } from './elements.js'
import { nodeTitleText, holdsEmbed } from './cards.js'
import { CARD_SIZES } from './layout.js'

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

/** lucide `maximize-2`: the card opens out to its whole content. */
const ENLARGE_ICON = '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>'

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

/** True for a form field or for editable text, where Space types or toggles. */
function isField(el) {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || el.matches('input, textarea, select')
}

/**
 * One board's reading views. `els` are their elements, with the board's host,
 * which places the preview, the wrapper, which the file view puts out of
 * reach, and the controls, which an enlarged card stays clear of. `config`
 * tells whether the board owns its page, `view` where an enlarged card's box
 * is on screen, and `observedNodes` the node each card element draws.
 * `actions` draw what a card holds, read and render notes, and move the focus
 * and the view.
 */
export function createReading(els, config, view, observedNodes, actions) {
  const {
    hostEl, wrapperEl, controlsEl, cardPreviewEl, cardPreviewTitleEl, cardPreviewGoEl, cardPreviewCloseEl,
    cardPreviewBodyEl, fileViewEl, fileViewBackEl, fileViewPathEl, fileViewToggleEl, fileViewBodyEl,
  } = els
  const {
    fillCard, noteHref, rawHref, renderMarkdown, markdownElement, fillFileNode, focusCard, focusedCard, flyToCard,
    setPageTitle,
  } = actions

  /** The card drawn whole over the board, or null, and the inline style it has on the board. */
  let enlargedCardEl = null
  let enlargedCardStyle = ''

  /** The card drawn whole over the board, or null. */
  function enlargedCard() {
    return enlargedCardEl
  }

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

  /**
   * Whether a press of Space enlarges the focused card, or puts it back. On a
   * board mounted in another page, Space scrolls that page, so the board takes it
   * only while the pointer is over the board. A form field keeps its Space, and
   * so does a file shown over the board.
   */
  function spaceToggles(event, pointerOverBoard) {
    const focusedCardEl = focusedCard()
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
      const focusedCardEl = focusedCard()
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

  return {
    enlargedCard, placeEnlargedCard, restoreEnlargedCard, installNodeEnlarge, installEnlargeKey, installEscapeKey,
    showCardPreview, closeCardPreview, installCardPreview, showFileView, openFile, closeFileView, showOnPlainClick,
    installFileView,
  }
}
