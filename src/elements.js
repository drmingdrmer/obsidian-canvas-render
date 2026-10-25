/**
 * The elements a board is drawn with: its markup, the elements it reaches by
 * id, and the icons and placeholders its cards and views put in.
 */

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** The board's elements; `mount` moves them into the shadow root it attaches. */
const BOARD_MARKUP = `
<div class="canvas-wrapper" id="wrapper">
  <div class="canvas-background" id="background"></div>

  <div class="canvas" id="canvas">
    <svg class="canvas-edges" id="edges" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="canvas-neighbours" id="neighbours">
      <svg class="canvas-neighbour-links" id="neighbour-links" xmlns="http://www.w3.org/2000/svg"></svg>
    </div>
  </div>

  <div class="canvas-margin" id="margin"></div>

  <div class="canvas-controls">
    <div class="canvas-control-group canvas-search">
      <input class="canvas-search-input" id="search" type="search" placeholder="Search cards"
        title="Find a card by its name or text" aria-label="Search cards" autocomplete="off" spellcheck="false">
      <div class="canvas-search-results" id="search-results" hidden></div>
    </div>

    <span class="canvas-control-divider"></span>
    <span class="canvas-control-group">
      <button class="canvas-control-item" id="zoom-out" title="Zoom out">&minus;</button>
      <button class="canvas-control-item" id="zoom-reset" title="Reset to 100%">100%</button>
      <button class="canvas-control-item" id="zoom-in" title="Zoom in">&plus;</button>
      <button class="canvas-control-item" id="zoom-fit" title="Fit to content">Fit</button>
    </span>

    <span class="canvas-control-divider"></span>
    <span class="canvas-control-group">
      <button class="canvas-control-item" id="text-smaller" title="Smaller text">&minus;</button>
      <button class="canvas-control-item" id="text-reset" title="Reset the text to 1×">1×</button>
      <button class="canvas-control-item" id="text-larger" title="Larger text">&plus;</button>
    </span>

    <span class="canvas-control-divider"></span>
    <span class="canvas-control-group">
      <button class="canvas-control-item" data-card-size="actual" title="Cards at the size the file stores">Actual</button>
      <button class="canvas-control-item" data-card-size="wide" title="Every card at one wide size">Wide</button>
      <button class="canvas-control-item" data-card-size="compact" title="Every card at one compact size">Compact</button>
    </span>

    <span class="canvas-control-divider"></span>
    <button class="canvas-control-item" id="grid-snap" title="Land a dragged card on the grid">Grid</button>

    <span class="canvas-control-divider"></span>
    <button class="canvas-control-item" id="history-toggle" title="Show the cards the focus has been on">History</button>

    <span class="canvas-control-divider"></span>
    <button class="canvas-control-item theme-toggle" title="Toggle light and dark theme">☾</button>
  </div>

  <div class="canvas-history" id="history" hidden>
    <div class="canvas-history-title">History</div>
    <div class="canvas-history-list" id="history-list"></div>
  </div>
</div>

<div class="file-view" id="file-view" hidden>
  <div class="file-view-header">
    <button class="file-view-back" id="file-view-back" title="Back to the board" hidden>←</button>
    <span class="file-view-path" id="file-view-path"></span>
    <a class="file-view-toggle" id="file-view-toggle"></a>
    <button class="file-view-theme theme-toggle" title="Toggle light and dark theme">☾</button>
  </div>
  <div class="file-view-body" id="file-view-body"></div>
</div>

<div class="card-preview" id="card-preview" hidden>
  <div class="card-preview-header">
    <span class="card-preview-title" id="card-preview-title"></span>
    <button class="card-preview-button card-preview-go" id="card-preview-go" title="Fly to this card on the board">Go to card</button>
    <button class="card-preview-button" id="card-preview-close" title="Close the preview">&times;</button>
  </div>
  <div class="card-preview-body" id="card-preview-body"></div>
</div>

<div class="canvas-status" id="status" hidden></div>
`

/** Builds one board's elements, and finds each one the board reaches. */
export function createElements() {
  const boardFragment = document.createRange().createContextualFragment(BOARD_MARKUP)
  const wrapperEl = boardFragment.getElementById('wrapper')
  const backgroundEl = boardFragment.getElementById('background')
  const canvasEl = boardFragment.getElementById('canvas')
  const edgesEl = boardFragment.getElementById('edges')
  const neighboursEl = boardFragment.getElementById('neighbours')
  const neighbourLinksEl = boardFragment.getElementById('neighbour-links')
  const marginEl = boardFragment.getElementById('margin')
  const statusEl = boardFragment.getElementById('status')
  const controlsEl = boardFragment.querySelector('.canvas-controls')
  const zoomInEl = boardFragment.getElementById('zoom-in')
  const zoomOutEl = boardFragment.getElementById('zoom-out')
  const zoomResetEl = boardFragment.getElementById('zoom-reset')
  const zoomFitEl = boardFragment.getElementById('zoom-fit')
  const textSmallerEl = boardFragment.getElementById('text-smaller')
  const textResetEl = boardFragment.getElementById('text-reset')
  const textLargerEl = boardFragment.getElementById('text-larger')
  const cardSizeEls = boardFragment.querySelectorAll('[data-card-size]')
  const gridSnapEl = boardFragment.getElementById('grid-snap')
  const historyToggleEl = boardFragment.getElementById('history-toggle')
  const historyEl = boardFragment.getElementById('history')
  const historyListEl = boardFragment.getElementById('history-list')
  const searchEl = boardFragment.getElementById('search')
  const searchResultsEl = boardFragment.getElementById('search-results')
  const themeToggleEls = boardFragment.querySelectorAll('.theme-toggle')
  const fileViewEl = boardFragment.getElementById('file-view')
  const fileViewBackEl = boardFragment.getElementById('file-view-back')
  const fileViewPathEl = boardFragment.getElementById('file-view-path')
  const fileViewToggleEl = boardFragment.getElementById('file-view-toggle')
  const fileViewBodyEl = boardFragment.getElementById('file-view-body')
  const cardPreviewEl = boardFragment.getElementById('card-preview')
  const cardPreviewTitleEl = boardFragment.getElementById('card-preview-title')
  const cardPreviewGoEl = boardFragment.getElementById('card-preview-go')
  const cardPreviewCloseEl = boardFragment.getElementById('card-preview-close')
  const cardPreviewBodyEl = boardFragment.getElementById('card-preview-body')

  return {
    boardFragment, wrapperEl, backgroundEl, canvasEl, edgesEl, neighboursEl, neighbourLinksEl, marginEl, statusEl,
    controlsEl, zoomInEl, zoomOutEl, zoomResetEl, zoomFitEl, textSmallerEl, textResetEl, textLargerEl, cardSizeEls,
    gridSnapEl, historyToggleEl, historyEl, historyListEl, searchEl, searchResultsEl, themeToggleEls, fileViewEl,
    fileViewBackEl, fileViewPathEl, fileViewToggleEl, fileViewBodyEl, cardPreviewEl, cardPreviewTitleEl,
    cardPreviewGoEl, cardPreviewCloseEl, cardPreviewBodyEl,
  }
}

export function createIcon(paths) {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
  icon.setAttribute('class', 'canvas-node-title-icon')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '2')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  icon.innerHTML = paths
  return icon
}

export function placeholderElement(message) {
  const el = document.createElement('div')
  el.className = 'canvas-node-placeholder'
  el.textContent = message
  return el
}
