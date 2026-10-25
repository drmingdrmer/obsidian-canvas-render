/**
 * One board: the cards and edges of a canvas in a pan/zoom viewport, the
 * controls over them, and the views that read its notes.
 */

import { contentBounds } from './geometry.js'
import { encodePath, fetchFile, createResources } from './resources.js'
import { createElements } from './elements.js'
import { createMarkdown } from './markdown.js'
import { createCardRenderer } from './cards.js'
import { createModel } from './model.js'
import { createLayout } from './layout.js'
import { createDragging } from './dragging.js'
import { isInteractiveTarget, createViewport } from './viewport.js'
import {
  DEFAULT_HISTORY_LENGTH, requestedCentre, requestedTextScale, preferredCardSize, requestedHistoryLength, createPage,
} from './page.js'
import { createNavigation } from './navigation.js'
import { createReading } from './reading.js'
import { createNeighbours } from './neighbours.js'
import { createMargins } from './margins.js'

// ---------------------------------------------------------------- constants

const DEFAULT_CANVAS_PATH = 'vault/demo.canvas'

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
    viewRect, layoutChanged, enlargedCard, placeEnlargedCard,
    restoreEnlargedCard, refitView, fitToContent,
  })

  /** Moving and resizing cards by hand. */
  const dragging = createDragging(gridSnapEl, config, view, model, {
    placeNode, sizeNode, resizeEdgeLayer, releaseAutoFit, isInteractiveTarget,
  })
  const { installGridSnapControl, installNodeDrag, installNodeResize } = dragging

  /** The previews of the focused card's neighbours, which In and Out show around it. */
  const neighbours = createNeighbours({ neighboursEl, neighbourLinksEl }, layout, {
    findNeighbours, fillNodeElement, fillNodeContent, resizeEdgeLayer, flyToCard,
  })
  const { installNodeButtons, hideNeighbours, placeNeighbours } = neighbours

  /** The titles in the margin of the cards out of view that an edge joins to the focused card. */
  const margins = createMargins({ wrapperEl, marginEl, historyEl, controlsEl }, view, model, layout, {
    focusedCard, flyToCard,
  })
  const { scheduleMarginTitles, installMarginTitles } = margins

  /** The card the focus is on, the search, and the history of the cards the focus has been on. */
  const navigationEls = { wrapperEl, searchEl, searchResultsEl, historyEl, historyListEl, historyToggleEl }
  const navigation = createNavigation(navigationEls, config, model, layout, {
    fitToContent, fitView, flyView, fillAllCards, restoreEnlargedCard, hideNeighbours, scheduleMarginTitles,
  })
  const { focusCard, showCard, installFocusHistory, installSearch } = navigation

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

  // Navigation, the reading views and the margin titles are built after parts
  // that call them: the viewport hands a press and a wheel to the focus, a link
  // in markdown or on a card opens a preview, a flight or the file view, the
  // layout keeps the enlarged card in step and fills the cards inside the
  // margin, and the margin titles follow the focus. These reach the three once
  // they exist.

  function focusOnPress(target) {
    navigation.focusOnPress(target)
  }

  function wheelScrollsCard(target) {
    return navigation.wheelScrollsCard(target)
  }

  function flyToCard(node) {
    navigation.flyToCard(node)
  }

  function focusedCard() {
    return navigation.focusedCard()
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

  function viewRect(width, height) {
    return margins.viewRect(width, height)
  }

  // -------------------------------------------------------------- coordination

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

  /**
   * A card moved or changed size, and its edges with it: the previews of In and
   * Out stand again around their card, and the titles in the margin follow.
   */
  function layoutChanged() {
    placeNeighbours()
    scheduleMarginTitles()
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
      // A group is all frame, with nothing to read.
      if (node.type !== 'group') installNodeEnlarge(el)
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
