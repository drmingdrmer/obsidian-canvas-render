/**
 * The part of a board in view: where the canvas sits and how far it is zoomed,
 * how large its text is drawn, the fits and flights that move it, and the
 * controls that pan and zoom it.
 */

import { contentBounds, viewSpan, flightPath, easeInOut } from './geometry.js'
import { GRID_SIZE } from './dragging.js'

/** The closest two background dots are drawn, in screen pixels; each dot is 2 px across. */
const MIN_DOT_SPACING = 8
const MIN_ZOOM = 0.1
const MAX_ZOOM = 3
const ZOOM_STEP = 1.15
const FIT_PADDING = 60
const FIT_MAX_ZOOM = 1

/**
 * The text size draws the text on the board from MIN_TEXT_SCALE to
 * MAX_TEXT_SCALE times its own size, in cards of the same size. A text button
 * multiplies it by TEXT_SCALE_STEP, about 1.1. Seven steps double the text, so
 * from 1 the buttons reach either end in 14 steps and come back to 1 from it.
 */
export const MIN_TEXT_SCALE = 0.25
export const MAX_TEXT_SCALE = 4
const TEXT_SCALE_STEP = 2 ** (1 / 7)

/**
 * A move to another card flies the view there on the path van Wijk and Nuij
 * give in "Smooth and efficient zooming and panning": it zooms out as it pans,
 * and back in as it lands, so that the way between the two cards stays in
 * sight. Each unit of the path's length takes FLIGHT_MS_PER_UNIT, and a flight
 * lasts from FLIGHT_MIN_MS to FLIGHT_MAX_MS.
 */
const FLIGHT_MS_PER_UNIT = 400
const FLIGHT_MIN_MS = 500
const FLIGHT_MAX_MS = 1500

/** Wheel delta that doubles the zoom, divided by ln 2. Larger means gentler. */
const ZOOM_WHEEL_SENSITIVITY = 400

/**
 * Card content scrolls and selects text, a card title is a link, the controls,
 * the bar in a preview's corner and a card's own buttons are there to be
 * pressed, and an enlarged card is there to be read: a press on any of them
 * neither pans the viewport nor drags the card it belongs to.
 *
 * Leaving the controls out of this would make them unclickable rather than
 * merely draggable: the pan captures the pointer, capture retargets the mouse
 * events a click is derived from, and the button never sees the click.
 */
export function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false
  const interactive = '.canvas-node-content, .canvas-node-title-link, .canvas-node-button, .canvas-node-bar, .canvas-node[data-enlarged="true"], .canvas-controls, .canvas-history, .canvas-margin-title'
  return target.closest(interactive) !== null
}

/**
 * One board's viewport. `els` are the elements it moves and the controls that
 * drive it, `config` holds the text size and tells whether the board owns its
 * page, and `model` gives the cards a fit takes in. `actions.viewChanged` runs
 * whenever the view moves, the window resizes or the reader changes the text
 * size. `actions.focusOnPress` and `actions.wheelScrollsCard` let the focus
 * decide what a press and a wheel do.
 */
export function createViewport(els, config, model, actions) {
  const {
    wrapperEl, canvasEl, backgroundEl, zoomInEl, zoomOutEl, zoomResetEl, zoomFitEl, textLargerEl, textSmallerEl,
    textResetEl,
  } = els
  const { viewChanged, focusOnPress, wheelScrollsCard } = actions

  /** Screen position of canvas origin, plus the current scale factor. */
  const view = { x: 0, y: 0, zoom: 1 }

  /**
   * The view as `fitToContent` last left it, and the node it fitted, null for the
   * whole board; a pan or a zoom by the reader makes it stale.
   */
  let fittedView = null

  /** The zoom controls stop at 10%, or lower when the last fit needed less to show the whole board. */
  let zoomFloor = MIN_ZOOM

  let shownZoomLabel = ''

  function applyView() {
    canvasEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
    // How large a card is drawn on screen, which a card's enlarge button undoes to keep one size.
    canvasEl.style.setProperty('--zoom', view.zoom)

    // Dots closer than MIN_DOT_SPACING run together into a flat grey, so a
    // zoomed-out board draws every second, fourth, … dot instead.
    let spacing = GRID_SIZE * view.zoom
    while (spacing > 0 && spacing < MIN_DOT_SPACING) spacing *= 2
    backgroundEl.style.backgroundSize = `${spacing}px ${spacing}px`
    // A dot sits at the centre of its tile, so the tiles start half a tile before
    // the points Grid snaps to.
    const tileX = view.x % spacing - spacing / 2
    const tileY = view.y % spacing - spacing / 2
    backgroundEl.style.backgroundPosition = `${tileX}px ${tileY}px`

    viewChanged()

    const zoomLabel = `${Math.round(view.zoom * 100)}%`
    if (zoomLabel === shownZoomLabel) return
    shownZoomLabel = zoomLabel
    zoomResetEl.textContent = zoomLabel
  }

  function zoomAt(screenX, screenY, nextZoom) {
    const clamped = Math.min(MAX_ZOOM, Math.max(zoomFloor, nextZoom))
    const canvasX = (screenX - view.x) / view.zoom
    const canvasY = (screenY - view.y) / view.zoom

    view.zoom = clamped
    view.x = screenX - canvasX * clamped
    view.y = screenY - canvasY * clamped
    applyView()
  }

  function zoomAroundCentre(nextZoom) {
    const rect = wrapperEl.getBoundingClientRect()
    zoomAt(rect.width / 2, rect.height / 2, nextZoom)
  }

  /** Draws the text on the board `textScale` times its own size, and shows that in its label. */
  function applyTextScale(textScale) {
    config.textScale = textScale
    canvasEl.style.setProperty('--text-scale', textScale)
    const shown = Number(textScale.toPrecision(2))
    textResetEl.textContent = `${shown}×`
  }

  /**
   * Makes the text on the cards and the edges larger or smaller, within the
   * range, while every card, line and image keeps its place and its size. A card
   * that Wide or Compact sizes by its content still follows its text, and
   * `cardSizeObserver` brings its edges along.
   */
  function scaleText(nextTextScale) {
    const textScale = Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, nextTextScale))
    applyTextScale(textScale)
    viewChanged()
  }

  /** The view that fits the bounds into the viewport, at zoom 1 at most. */
  function fitView(bounds) {
    const rect = wrapperEl.getBoundingClientRect()
    const contentWidth = bounds.maxX - bounds.minX
    const contentHeight = bounds.maxY - bounds.minY

    // A viewport smaller than the padding still gets a scale above zero.
    const availableWidth = Math.max(rect.width - FIT_PADDING * 2, 1)
    const availableHeight = Math.max(rect.height - FIT_PADDING * 2, 1)
    const scaleX = availableWidth / Math.max(contentWidth, 1)
    const scaleY = availableHeight / Math.max(contentHeight, 1)
    const scale = Math.min(scaleX, scaleY, FIT_MAX_ZOOM)

    const x = rect.width / 2 - (bounds.minX + contentWidth / 2) * scale
    const y = rect.height / 2 - (bounds.minY + contentHeight / 2) * scale
    return { x, y, zoom: scale }
  }

  /**
   * Fits the bounds into the viewport, at zoom 1 at most, and remembers what was
   * fitted: the whole board, or the one node passed in.
   */
  function fitToContent(bounds, node = null) {
    const fitted = fitView(bounds)
    view.zoom = fitted.zoom
    // A card fitted on its own leaves the floor where the board's fit put it.
    if (node === null) zoomFloor = Math.min(MIN_ZOOM, fitted.zoom)
    view.x = fitted.x
    view.y = fitted.y
    applyView()
    fittedView = { x: view.x, y: view.y, zoom: view.zoom, node: node }
  }

  /** True while the view is still the one that was fitted, untouched since. */
  function viewIsAsFitted() {
    if (fittedView === null) return false

    const samePan = view.x === fittedView.x && view.y === fittedView.y
    return samePan && view.zoom === fittedView.zoom
  }

  /**
   * Fits the view again to what it was last fitted to, the board or one card,
   * once the window or a card has changed size — unless the reader has moved
   * the view since.
   */
  function refitView() {
    if (!viewIsAsFitted()) return

    const node = fittedView.node
    const nodes = node === null ? model.nodes : [node]
    fitToContent(contentBounds(nodes), node)
  }

  /** The id of the flight's next animation frame, which a new flight cancels. */
  let flightFrame = 0

  /**
   * Moves the view to `target`, `{ x, y, zoom }`, along `flightPath`, and calls
   * `land` at the end. A press on the board, or anything else that moves the view
   * on the way, such as a wheel or a button, ends the flight where the view is.
   * With reduced motion asked for, the view lands at once.
   */
  function flyView(target, land) {
    cancelAnimationFrame(flightFrame)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      land()
      return
    }

    const rect = wrapperEl.getBoundingClientRect()
    // The longer side of the viewport measures how much of the canvas is in sight.
    const size = Math.max(rect.width, rect.height)
    const viewport = { centreX: rect.width / 2, centreY: rect.height / 2, size: size }
    const path = flightPath(viewSpan(view, viewport), viewSpan(target, viewport))
    const pathTime = path.length * FLIGHT_MS_PER_UNIT
    const duration = Math.min(Math.max(pathTime, FLIGHT_MIN_MS), FLIGHT_MAX_MS)
    const start = performance.now()
    let shown = { ...view }

    const step = now => {
      const moved = view.x !== shown.x || view.y !== shown.y || view.zoom !== shown.zoom
      if (moved) return
      // A frame's time can be a little earlier than the start.
      const elapsed = Math.max(now - start, 0)
      const t = Math.min(elapsed / duration, 1)
      if (t === 1) {
        land()
        return
      }

      const span = path.at(easeInOut(t))
      view.zoom = viewport.size / span.width
      view.x = viewport.centreX - span.x * view.zoom
      view.y = viewport.centreY - span.y * view.zoom
      applyView()
      shown = { ...view }
      flightFrame = requestAnimationFrame(step)
    }
    flightFrame = requestAnimationFrame(step)
  }

  function installViewportControls() {
    let panPointerId = null
    let panOriginX = 0
    let panOriginY = 0

    // In the capture phase, so that presses a card handles itself — its title
    // bar, its resize grip — still move the focus onto it.
    wrapperEl.addEventListener('pointerdown', event => focusOnPress(event.target), true)

    wrapperEl.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.button !== 1) return
      if (event.button === 0 && isInteractiveTarget(event.target)) return

      // A press holds the board where it is, rather than where a flight takes it.
      cancelAnimationFrame(flightFrame)
      panPointerId = event.pointerId
      panOriginX = event.clientX - view.x
      panOriginY = event.clientY - view.y
      wrapperEl.classList.add('is-panning')
      wrapperEl.setPointerCapture(panPointerId)
      event.preventDefault()
    })

    wrapperEl.addEventListener('pointermove', event => {
      if (event.pointerId !== panPointerId) return
      view.x = event.clientX - panOriginX
      view.y = event.clientY - panOriginY
      applyView()
    })

    const endPan = event => {
      if (event.pointerId !== panPointerId) return
      wrapperEl.releasePointerCapture(panPointerId)
      wrapperEl.classList.remove('is-panning')
      panPointerId = null
    }
    wrapperEl.addEventListener('pointerup', endPan)
    wrapperEl.addEventListener('pointercancel', endPan)

    // On a board that leaves the plain wheel to its page, only the focused card
    // scrolls: any other card under the pointer would take the wheel instead.
    if (!config.ownsPage) wrapperEl.dataset.wheel = 'page'
    wrapperEl.addEventListener(
      'wheel',
      event => {
        // A trackpad pinch arrives as a wheel event with ctrlKey set. Alt turns
        // the wheel, or the pinch, into the text size.
        if (event.ctrlKey || event.metaKey || event.altKey) {
          event.preventDefault()
          const factor = Math.exp(-event.deltaY / ZOOM_WHEEL_SENSITIVITY)
          // A board mounted in a page need not start at the window's corner.
          const rect = wrapperEl.getBoundingClientRect()
          const screenX = event.clientX - rect.left
          const screenY = event.clientY - rect.top
          if (event.altKey) scaleText(config.textScale * factor)
          else zoomAt(screenX, screenY, view.zoom * factor)
          return
        }

        if (wheelScrollsCard(event.target)) return
        // A board mounted in another page leaves the plain wheel to that page.
        if (!config.ownsPage) return

        event.preventDefault()
        view.x -= event.deltaX
        view.y -= event.deltaY
        applyView()
      },
      { passive: false },
    )

    zoomInEl.addEventListener('click', () => zoomAroundCentre(view.zoom * ZOOM_STEP))
    zoomOutEl.addEventListener('click', () => zoomAroundCentre(view.zoom / ZOOM_STEP))
    zoomResetEl.addEventListener('click', () => zoomAroundCentre(1))
    textLargerEl.addEventListener('click', () => scaleText(config.textScale * TEXT_SCALE_STEP))
    textSmallerEl.addEventListener('click', () => scaleText(config.textScale / TEXT_SCALE_STEP))
    textResetEl.addEventListener('click', () => scaleText(1))
    // Recomputed at click time: a drag leaves the bounds captured at load stale.
    zoomFitEl.addEventListener('click', () => fitToContent(contentBounds(model.nodes)))

    // A resized window refits the view, unless the reader has moved it since the
    // fit; a moved view keeps its corner, so the address bar takes its new centre.
    // An enlarged card takes the room the board has now.
    const observer = new ResizeObserver(() => {
      refitView()
      viewChanged()
    })
    observer.observe(wrapperEl)
  }

  /** Puts the canvas point `at` names at the centre of the viewport, then zooms around it to its zoom. */
  function centreView(centre) {
    const rect = wrapperEl.getBoundingClientRect()
    const screenX = rect.width / 2
    const screenY = rect.height / 2
    view.x = screenX - centre.x * view.zoom
    view.y = screenY - centre.y * view.zoom
    zoomAt(screenX, screenY, centre.zoom)
  }

  /** From here on the reader arranges the board, so nothing re-fits the view for them. */
  function releaseAutoFit() {
    fittedView = null
  }

  /**
   * The view as a link records it: whether it is still the view fitted to
   * `fittedNode`, a card or null for the whole board, and its `centre`, the
   * canvas point at the centre of the viewport with the zoom, as `centreView`
   * takes it.
   */
  function viewSnapshot() {
    const isAsFitted = viewIsAsFitted()
    const fittedNode = isAsFitted ? fittedView.node : null
    const rect = wrapperEl.getBoundingClientRect()
    const centreX = (rect.width / 2 - view.x) / view.zoom
    const centreY = (rect.height / 2 - view.y) / view.zoom
    const centre = { x: centreX, y: centreY, zoom: view.zoom }
    return { isAsFitted, fittedNode, centre }
  }

  return {
    view, applyView, zoomAt, applyTextScale, fitView, fitToContent, refitView, flyView, installViewportControls,
    centreView, releaseAutoFit, viewSnapshot,
  }
}
