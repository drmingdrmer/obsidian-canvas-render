/**
 * The page a board is drawn on: what its address asks for, the theme and the
 * reader's stored choices, and, on the renderer's own page, the title and the
 * address bar.
 */

import { CARD_SIZES, CARD_SIZE_STORAGE_KEY } from './layout.js'
import { MIN_TEXT_SCALE, MAX_TEXT_SCALE } from './viewport.js'

const THEME_STORAGE_KEY = 'canvas-render-theme'

const CARD_SIZE_NAMES = Object.keys(CARD_SIZES)

/** How many cards the History list keeps, unless the `history` parameter names another number. */
export const DEFAULT_HISTORY_LENGTH = 100

/**
 * How long the view has to stay put, in milliseconds, before the address bar
 * follows it. Following every frame of a pan would run into Safari's limit of
 * 100 history changes in 10 seconds, past which `replaceState` throws.
 */
const VIEW_URL_DELAY = 300

/** `at=<x>,<y>,<zoom>`: three decimal numbers, the zoom without a sign. */
const AT_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/

/**
 * The view the `at` parameter names, or null without one: the canvas point at
 * the centre of the viewport, and the zoom. A centre rather than a corner keeps
 * a link on the same spot in a window of another size.
 */
export function requestedCentre(params) {
  const value = params.get('at')
  if (value === null) return null

  const match = AT_PATTERN.exec(value)
  if (match === null) throw new Error(`the at parameter accepts <x>,<y>,<zoom>, got ${value}`)
  const [x, y, zoom] = match.slice(1).map(Number)
  return { x: x, y: y, zoom: zoom }
}

/** The text size the `text` parameter names, or 1, the text's own size, without one. */
export function requestedTextScale(params) {
  const value = params.get('text')
  if (value === null) return 1

  const textScale = Number(value)
  const inRange = textScale >= MIN_TEXT_SCALE && textScale <= MAX_TEXT_SCALE
  if (!inRange) {
    throw new Error(`the text parameter accepts a number from ${MIN_TEXT_SCALE} to ${MAX_TEXT_SCALE}, got ${value}`)
  }
  return textScale
}

/** The `cards` parameter names a size for one page load; the control persists a choice. */
export function preferredCardSize(params) {
  const requested = params.get('cards')
  if (requested !== null) {
    if (Object.hasOwn(CARD_SIZES, requested)) return requested
    const names = CARD_SIZE_NAMES.join(', ')
    throw new Error(`the cards parameter accepts ${names}, got ${requested}`)
  }

  const stored = localStorage.getItem(CARD_SIZE_STORAGE_KEY)
  if (stored !== null && Object.hasOwn(CARD_SIZES, stored)) return stored
  return 'actual'
}

/** The number of cards the `history` parameter names, or DEFAULT_HISTORY_LENGTH without one. */
export function requestedHistoryLength(params) {
  const value = params.get('history')
  if (value === null) return DEFAULT_HISTORY_LENGTH

  const historyLength = Number(value)
  const isCount = Number.isInteger(historyLength) && historyLength >= 1
  if (!isCount) throw new Error(`the history parameter accepts a whole number from 1 up, got ${value}`)
  return historyLength
}

/**
 * One board's page. `hostEl` carries the theme, which each of `themeToggleEls`
 * flips. On the renderer's own page, as `config.ownsPage` tells, the title
 * names the file shown, and the address bar follows the text size and the view
 * that `viewSnapshot()` gives.
 */
export function createPage(hostEl, themeToggleEls, config, viewSnapshot) {
  function preferredTheme() {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored) return stored

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (prefersDark) return 'dark'
    return 'light'
  }

  function applyTheme(theme) {
    hostEl.dataset.theme = theme
    const glyph = theme === 'dark' ? '☀' : '☾'
    for (const toggleEl of themeToggleEls) toggleEl.textContent = glyph
  }

  /** Every view carries a toggle, so the wiring cannot live with the canvas controls. */
  function installThemeToggles() {
    applyTheme(preferredTheme())
    for (const toggleEl of themeToggleEls) {
      toggleEl.addEventListener('click', () => {
        const isDark = hostEl.dataset.theme === 'dark'
        const theme = isDark ? 'light' : 'dark'
        applyTheme(theme)
        // Only a choice is stored: until the reader makes one, each load follows the OS.
        localStorage.setItem(THEME_STORAGE_KEY, theme)
      })
    }
  }

  /** On the renderer's own page, the title names the file the file view shows. */
  function setPageTitle(path) {
    if (!config.ownsPage) return
    document.title = path
  }

  /** The pending rewrite of the address bar, put off while the view keeps moving. */
  let viewUrlTimer = 0

  function scheduleViewUrl() {
    if (!config.ownsPage) return
    clearTimeout(viewUrlTimer)
    viewUrlTimer = setTimeout(writeViewUrl, VIEW_URL_DELAY)
  }

  /**
   * The view as a link spells it: `focus=<id>` while it is fitted to one card,
   * nothing while it is fitted to the whole board, which a link opens on anyway,
   * and otherwise `at=` with the canvas point at the centre and the zoom.
   */
  function viewParameter() {
    const { isAsFitted, fittedNode, centre } = viewSnapshot()
    if (isAsFitted) {
      if (fittedNode === null) return null
      return `focus=${encodeURIComponent(fittedNode.id)}`
    }

    const zoom = Number(centre.zoom.toPrecision(3))
    return `at=${Math.round(centre.x)},${Math.round(centre.y)},${zoom}`
  }

  /**
   * Rewrites `at`, `focus` and `text` in the address bar to the view, and keeps
   * every other parameter as it was typed: URLSearchParams would encode the
   * slashes in `canvas` and the commas in `at`.
   */
  function writeViewUrl() {
    const pairs = window.location.search.slice(1).split('&')
    const parameters = pairs.filter(pair => {
      const name = pair.split('=')[0]
      return name !== '' && name !== 'at' && name !== 'focus' && name !== 'text'
    })
    const viewPair = viewParameter()
    if (viewPair !== null) parameters.push(viewPair)
    const textScale = Number(config.textScale.toPrecision(3))
    if (textScale !== 1) parameters.push(`text=${textScale}`)

    const search = parameters.length === 0 ? '' : `?${parameters.join('&')}`
    if (search === window.location.search) return
    history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`)
  }

  return { installThemeToggles, setPageTitle, scheduleViewUrl }
}
