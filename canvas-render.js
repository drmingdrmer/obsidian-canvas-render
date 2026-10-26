/**
 * Renders a JSON Canvas file (https://jsoncanvas.org) the way Obsidian draws it:
 * nodes are absolutely positioned DOM elements, edges are one SVG layer beneath
 * them, and the whole thing sits in a pan/zoom viewport over a dot grid.
 *
 * An ES module: `mount` draws the board inside an element of any page.
 */

// ---------------------------------------------------------------- constants

/** The folder this module is served from, which holds its stylesheets and the renderer's own page. */
const APP_URL = new URL('./', import.meta.url)

const KATEX_STYLESHEET = 'lib/katex/katex.min.css'

/** The stylesheets a board's shadow root links, relative to this module; the board's own come last, to win. */
const BOARD_STYLESHEETS = [KATEX_STYLESHEET, 'canvas-render.css']

/**
 * The libraries the board calls, as the global each one's script defines and
 * the script's path relative to this module. A page that has loaded one
 * already lends it to the board.
 */
const LIBRARIES = [
  ['marked', 'lib/marked.min.js'],
  ['katex', 'lib/katex/katex.min.js'],
  ['DOMPurify', 'lib/purify.min.js'],
]

/**
 * The modules in src/, as paths relative to this module. A module names its
 * imports only once it has arrived, so importing src/board.js alone takes one
 * round of requests for it and another for the modules it imports. `mount`
 * asks for all of them at once instead, along with the libraries.
 */
const MODULES = [
  'src/board.js', 'src/cards.js', 'src/dragging.js', 'src/elements.js', 'src/geometry.js',
  'src/layout.js', 'src/margins.js', 'src/markdown.js', 'src/model.js', 'src/navigation.js',
  'src/neighbours.js', 'src/page.js', 'src/reading.js', 'src/resources.js', 'src/viewport.js',
]

/**
 * Hosts besides this page's own origin that a canvas, a vault, a note or a file
 * card may be loaded from. Rendered markdown is stripped of script, but
 * everything else in it — text, images, links, forms — appears as this page's
 * own content, so extending the list is a trust decision.
 */
const REMOTE_HOSTS = ['raw.githubusercontent.com']

// --------------------------------------------------------------------- state

/** The element `mount` drew the board in, null until then; it carries the theme and the view mode. */
let hostEl = null

// ----------------------------------------------------------------- bootstrap

/** Appends `el`, a `<link>` or a `<script>`, to `parent`, and resolves once the file at `url` has loaded. */
function appendLoaded(parent, el, url) {
  const loaded = new Promise((resolve, reject) => {
    el.addEventListener('load', resolve)
    el.addEventListener('error', () => reject(new Error(`Cannot load ${url}`)))
  })
  parent.append(el)
  return loaded
}

function linkStylesheet(parent, path) {
  const linkEl = document.createElement('link')
  linkEl.rel = 'stylesheet'
  linkEl.href = new URL(path, APP_URL).href
  return appendLoaded(parent, linkEl, linkEl.href)
}

/** Runs a library as a classic script, which defines the library's global. */
function loadLibrary(path) {
  const scriptEl = document.createElement('script')
  scriptEl.src = new URL(path, APP_URL).href
  return appendLoaded(document.head, scriptEl, scriptEl.src)
}

/**
 * Links the board's stylesheets into its shadow root, and loads each library
 * the page has not. A shadow root ignores `@font-face`, so KaTeX's stylesheet
 * goes into the page's head as well, to declare its fonts.
 */
function loadAssets(shadowRoot) {
  const loads = [linkStylesheet(document.head, KATEX_STYLESHEET)]
  for (const path of BOARD_STYLESHEETS) loads.push(linkStylesheet(shadowRoot, path))
  for (const [name, path] of LIBRARIES) {
    if (name in window) continue
    loads.push(loadLibrary(path))
  }
  return Promise.all(loads)
}

/** Asks for every module in src/, so that importing src/board.js finds each one loaded or on its way. */
function preloadModules() {
  for (const path of MODULES) {
    const linkEl = document.createElement('link')
    linkEl.rel = 'modulepreload'
    linkEl.href = new URL(path, APP_URL).href
    document.head.append(linkEl)
  }
}

/**
 * Draws a board inside `el`, in a shadow root, which keeps the page's styles
 * and the board's apart. A page shows one board.
 *
 * Without `params`, the board is the whole page: it reads the parameters from
 * the page's address and keeps its view there. With `params`, anything
 * `URLSearchParams` takes, such as `{ canvas: 'boards/raft.canvas' }`, it
 * reads those, and leaves the page's address and title alone. Either way, a
 * relative path is relative to the page's address.
 *
 * Resolves once the board is drawn. A board that cannot be drawn shows why,
 * and the promise rejects.
 */
export async function mount(el, params) {
  if (!(el instanceof Element)) throw new TypeError(`mount draws a board in an element, got ${el}`)
  if (hostEl !== null) throw new Error('mount draws one board per page, and this page has one')
  const shadowRoot = el.attachShadow({ mode: 'open' })
  hostEl = el
  preloadModules()
  const assetsLoaded = loadAssets(shadowRoot)
  const boardLoaded = import('./src/board.js')
  // The modules and the assets load side by side. Waiting on both at once keeps
  // an asset that fails before the board arrives from being reported as an
  // unhandled rejection; the board shows that failure once it is created.
  await Promise.allSettled([assetsLoaded, boardLoaded])
  const { createBoard } = await boardLoaded
  const ownsPage = params === undefined
  const board = createBoard(el, ownsPage, APP_URL, REMOTE_HOSTS)
  const query = ownsPage ? window.location.search : params
  try {
    await assetsLoaded
    shadowRoot.append(board.boardFragment)
    await board.main(new URLSearchParams(query), { marked, katex, DOMPurify })
  } catch (error) {
    // The markup waits for its stylesheets, so a failed load has left it out.
    shadowRoot.append(board.boardFragment)
    board.showStatus(String(error.message || error))
    throw error
  }
}
