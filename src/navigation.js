/**
 * Where a board's reader is: the card the focus is on, which a press, a search
 * or a link puts there, the moves of the view that take the reader to a card,
 * and the history of the cards the focus has been on.
 */

import { contentBounds } from './geometry.js'
import { cardName } from './model.js'

const HISTORY_STORAGE_KEY = 'canvas-render-history'

/**
 * One board's navigation. `els` are the search box and the history, with the
 * board's wrapper, where a press closes the search results. `config` gives the
 * length of the history, `model` the cards, and `layout` the element each card
 * is drawn as. `actions` move the view to a card, draw every card for a
 * search, and keep the rest of the board in step with the focus: the enlarged
 * card goes back, the previews of In and Out go, and the margin titles follow.
 */
export function createNavigation(els, config, model, layout, actions) {
  const { wrapperEl, searchEl, searchResultsEl, historyEl, historyListEl, historyToggleEl } = els
  const {
    fitToContent, fitView, flyView, fillAllCards, restoreEnlargedCard, hideNeighbours, scheduleMarginTitles,
  } = actions

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

  /** The card the focus is on, or null while the focus is on the board. */
  function focusedCard() {
    return focusedCardEl
  }

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
    searchEl.addEventListener('focus', fillAllCards)
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

  return {
    focusOnPress, focusCard, showCard, flyToCard, wheelScrollsCard, focusedCard, installFocusHistory, installSearch,
  }
}
