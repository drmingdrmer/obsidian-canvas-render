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

const DEFAULT_CANVAS_PATH = 'vault/demo.canvas'
const THEME_STORAGE_KEY = 'canvas-render-theme'
const CARD_SIZE_STORAGE_KEY = 'canvas-render-card-size'
const GRID_SNAP_STORAGE_KEY = 'canvas-render-grid-snap'

/**
 * What the card-size control offers, one button each. `actual` draws every card
 * at the size its file gives it. The other two ignore that size, fix one width
 * for the whole board and let the content set the height, up to a cap that
 * keeps a long note from towering over the rest.
 */
const CARD_SIZES = {
  actual: { width: null, maxHeight: null },
  wide: { width: 520, maxHeight: 480 },
  compact: { width: 320, maxHeight: 240 },
}

const CARD_SIZE_NAMES = Object.keys(CARD_SIZES)

/**
 * Hosts besides this page's own origin that a canvas, a vault, a note or a file
 * card may be loaded from. Rendered markdown is stripped of script, but
 * everything else in it — text, images, links, forms — appears as this page's
 * own content, so extending the list is a trust decision.
 */
const REMOTE_HOSTS = ['raw.githubusercontent.com']

/**
 * marked passes raw HTML through untouched, so rendered markdown goes through
 * DOMPurify. KaTeX writes every formula in MathML as well as in HTML, and
 * `semantics` and `annotation` are the two of its elements DOMPurify drops by
 * default.
 */
const SANITIZE_OPTIONS = { ADD_TAGS: ['semantics', 'annotation'], RETURN_DOM_FRAGMENT: true }

/**
 * A link card frames a page from any host. The page runs as it would in a tab
 * of its own, but cannot navigate this page or open dialogs over it. A page on
 * this page's own origin could lift the sandbox, but such a page comes from
 * this site. File cards get no sandbox: Chrome refuses to show a PDF in a
 * sandboxed frame.
 */
const LINK_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'

const GRID_SIZE = 20
/** The closest two background dots are drawn, in screen pixels; each dot is 2 px across. */
const MIN_DOT_SPACING = 8
const MIN_CARD_WIDTH = 120
const MIN_CARD_HEIGHT = 60
const MIN_ZOOM = 0.1
const MAX_ZOOM = 3
const ZOOM_STEP = 1.15
const FIT_PADDING = 60
const FIT_MAX_ZOOM = 1

/** Wheel delta that doubles the zoom, divided by ln 2. Larger means gentler. */
const ZOOM_WHEEL_SENSITIVITY = 400

/**
 * How long the view has to stay put, in milliseconds, before the address bar
 * follows it. Following every frame of a pan would run into Safari's limit of
 * 100 history changes in 10 seconds, past which `replaceState` throws.
 */
const VIEW_URL_DELAY = 300

/** Extra room around the node bounding box so bowed edges are not clipped. */
const EDGE_LAYER_MARGIN = 400

const EDGE_MIN_CONTROL_OFFSET = 24
const EDGE_CONTROL_RATIO = 0.35
const ARROW_LENGTH = 13
const ARROW_HALF_WIDTH = 7

/** Obsidian's six preset canvas colors, keyed by the string used in the file. */
const PRESET_COLORS = {
  '1': '#fb464c',
  '2': '#e9973f',
  '3': '#e0de71',
  '4': '#44cf6e',
  '5': '#53dfdd',
  '6': '#a882ff',
}

const SIDE_NORMALS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif']

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

// ------------------------------------------------------------------ elements

/** The board's elements, built once; `mount` moves them into the shadow root it attaches. */
const BOARD_MARKUP = `
<div class="canvas-wrapper" id="wrapper">
  <div class="canvas-background" id="background"></div>

  <div class="canvas" id="canvas">
    <svg class="canvas-edges" id="edges" xmlns="http://www.w3.org/2000/svg"></svg>
  </div>

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
      <button class="canvas-control-item" data-card-size="actual" title="Cards at the size the file stores">Actual</button>
      <button class="canvas-control-item" data-card-size="wide" title="Every card at one wide size">Wide</button>
      <button class="canvas-control-item" data-card-size="compact" title="Every card at one compact size">Compact</button>
    </span>

    <span class="canvas-control-divider"></span>
    <button class="canvas-control-item" id="grid-snap" title="Land a dragged card on the grid">Grid</button>

    <span class="canvas-control-divider"></span>
    <button class="canvas-control-item theme-toggle" title="Toggle light and dark theme">☾</button>
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

<div class="canvas-status" id="status" hidden></div>
`

const boardFragment = document.createRange().createContextualFragment(BOARD_MARKUP)
const wrapperEl = boardFragment.getElementById('wrapper')
const backgroundEl = boardFragment.getElementById('background')
const canvasEl = boardFragment.getElementById('canvas')
const edgesEl = boardFragment.getElementById('edges')
const statusEl = boardFragment.getElementById('status')
const zoomInEl = boardFragment.getElementById('zoom-in')
const zoomOutEl = boardFragment.getElementById('zoom-out')
const zoomResetEl = boardFragment.getElementById('zoom-reset')
const zoomFitEl = boardFragment.getElementById('zoom-fit')
const cardSizeEls = boardFragment.querySelectorAll('[data-card-size]')
const gridSnapEl = boardFragment.getElementById('grid-snap')
const searchEl = boardFragment.getElementById('search')
const searchResultsEl = boardFragment.getElementById('search-results')
const themeToggleEls = boardFragment.querySelectorAll('.theme-toggle')
const fileViewEl = boardFragment.getElementById('file-view')
const fileViewBackEl = boardFragment.getElementById('file-view-back')
const fileViewPathEl = boardFragment.getElementById('file-view-path')
const fileViewToggleEl = boardFragment.getElementById('file-view-toggle')
const fileViewBodyEl = boardFragment.getElementById('file-view-body')

// --------------------------------------------------------------------- state

/** The element `mount` drew the board in, null until then; it carries the theme and the view mode. */
let hostEl = null

/** The board's own marked, made by `main`, so that a page's own `marked` keeps its options. */
let markdownParser = null

/** Screen position of canvas origin, plus the current scale factor. */
const view = { x: 0, y: 0, zoom: 1 }

/**
 * The view as `fitToContent` last left it, and the node it fitted, null for the
 * whole board; a pan or a zoom by the reader makes it stale.
 */
let fittedView = null

/** The zoom controls stop at 10%, or lower when the last fit needed less to show the whole board. */
let zoomFloor = MIN_ZOOM

/**
 * Read from the parameters at startup; the card size and the grid follow their
 * controls. `ownsPage` is false for a board mounted in another page, which
 * leaves that page's address and title alone.
 */
const config = { canvasPath: '', vaultRoot: '', attachments: null, cardSize: 'actual', snapToGrid: false, ownsPage: true }

/**
 * The drawn canvas: node data, the element each node was drawn as, the edges on
 * it, and the sizes the file authored — which the node data no longer holds
 * once a card is drawn at a size of its own.
 */
const layout = { nodes: [], elements: new Map(), edgesByNode: new Map(), authoredSizes: new Map() }

// --------------------------------------------------------------------- theme

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

// ------------------------------------------------------------------ markdown

/** `$$tex$$` on lines of its own. */
const MATH_BLOCK = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/

/** `$$tex$$` inside a line of text. */
const MATH_DISPLAY = /^\$\$([\s\S]+?)\$\$/

/** `$tex$`. It must end in a non-space character, so that `between $5 and $10` stays text. */
const MATH_INLINE = /^\$((?:[^$\\\n]|\\.)*?(?:[^\s$\\]|\\.))\$/

const WIKILINK = /^\[\[([^[\]]+?)\]\]/

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function stripFrontmatter(source) {
  const match = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) return source
  return source.slice(match[0].length)
}

/**
 * `[[target|alias]]` and `[[target#heading]]` become a link with no destination
 * yet: where it leads depends on the document it is written in, which
 * `linkWikilink` knows.
 */
function wikilinkToHtml(body) {
  const pipeIndex = body.indexOf('|')
  const hasAlias = pipeIndex >= 0
  const target = hasAlias ? body.slice(0, pipeIndex) : body
  const alias = hasAlias ? body.slice(pipeIndex + 1) : ''
  // `Note#Heading` reads `Note > Heading`, as in Obsidian's reading view.
  const sections = target.split('#').map(section => section.trim())
  const targetLabel = sections.filter(section => section !== '').join(' > ')
  const label = alias.trim() === '' ? targetLabel : alias.trim()
  return `<a class="internal-link" title="${escapeHtml(target.trim())}">${escapeHtml(label)}</a>`
}

function renderMath(item) {
  return katex.renderToString(item.body, {
    displayMode: item.display,
    throwOnError: false,
    strict: false,
  })
}

/**
 * Math and wikilinks are marked's own syntax, so marked keeps them literal in
 * code, as Obsidian does, and no other markdown rule reaches inside a formula
 * to take its `_`, `*` or `\` for emphasis or an escape.
 *
 * A formula on lines of its own is a block: it ends the paragraph above it,
 * and a `---` under it is a rule rather than the underline of a heading.
 */
const MARKDOWN_EXTENSIONS = [
  {
    name: 'mathBlock',
    level: 'block',
    start(src) {
      const match = src.match(/^\$\$/m)
      return match === null ? undefined : match.index
    },
    tokenizer(src) {
      const match = src.match(MATH_BLOCK)
      if (match === null) return undefined
      return { type: 'mathBlock', raw: match[0], body: match[1], display: true }
    },
    renderer: token => `${renderMath(token)}\n`,
  },
  {
    name: 'math',
    level: 'inline',
    start: src => src.indexOf('$'),
    tokenizer(src) {
      const display = src.match(MATH_DISPLAY)
      if (display !== null) return { type: 'math', raw: display[0], body: display[1], display: true }

      const inline = src.match(MATH_INLINE)
      if (inline === null) return undefined
      return { type: 'math', raw: inline[0], body: inline[1], display: false }
    },
    renderer: token => renderMath(token),
  },
  {
    name: 'wikilink',
    level: 'inline',
    start: src => src.indexOf('[['),
    tokenizer(src) {
      const match = src.match(WIKILINK)
      if (match === null) return undefined
      return { type: 'wikilink', raw: match[0], body: match[1] }
    },
    renderer: token => wikilinkToHtml(token.body),
  },
]

function renderMarkdown(source) {
  const body = stripFrontmatter(source)
  return markdownParser.parse(body)
}

/**
 * Keeps only the section a `#Heading` subpath points at. The headings are the
 * ones marked parses, so a `#` line inside code is none, and a setext heading
 * is one.
 */
function sliceSubpath(markdown, subpath) {
  if (!subpath) return markdown
  if (!subpath.startsWith('#')) return markdown

  const heading = subpath.slice(1).trim()
  const blocks = markdownParser.lexer(markdown)
  const isTargetHeading = block => {
    if (block.type !== 'heading') return false
    return block.text.trim() === heading
  }

  const startIndex = blocks.findIndex(isTargetHeading)
  if (startIndex < 0) return markdown

  const startDepth = blocks[startIndex].depth
  let endIndex = blocks.length
  for (let i = startIndex + 1; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.type !== 'heading') continue
    if (block.depth > startDepth) continue
    endIndex = i
    break
  }

  return blocks.slice(startIndex, endIndex).map(block => block.raw).join('')
}

// ------------------------------------------------------------------ geometry

function sideAnchor(node, side) {
  if (side === 'top') return { x: node.x + node.width / 2, y: node.y }
  if (side === 'bottom') return { x: node.x + node.width / 2, y: node.y + node.height }
  if (side === 'left') return { x: node.x, y: node.y + node.height / 2 }
  return { x: node.x + node.width, y: node.y + node.height / 2 }
}

/** JSON Canvas allows omitting a side; pick the one facing the other node. */
function inferSide(node, other) {
  const dx = other.x + other.width / 2 - (node.x + node.width / 2)
  const dy = other.y + other.height / 2 - (node.y + node.height / 2)
  const isHorizontal = Math.abs(dx) >= Math.abs(dy)

  if (isHorizontal) {
    const towardsRight = dx >= 0
    return towardsRight ? 'right' : 'left'
  }

  const towardsBottom = dy >= 0
  return towardsBottom ? 'bottom' : 'top'
}

/**
 * Cubic bezier whose control points leave each anchor along that side's outward
 * normal — this is what gives Obsidian edges their characteristic S shape.
 */
function edgeGeometry(fromNode, fromSide, toNode, toSide) {
  const start = sideAnchor(fromNode, fromSide)
  const end = sideAnchor(toNode, toSide)
  const startNormal = SIDE_NORMALS[fromSide]
  const endNormal = SIDE_NORMALS[toSide]

  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const offset = Math.max(EDGE_MIN_CONTROL_OFFSET, distance * EDGE_CONTROL_RATIO)

  const startControl = { x: start.x + startNormal.x * offset, y: start.y + startNormal.y * offset }
  const endControl = { x: end.x + endNormal.x * offset, y: end.y + endNormal.y * offset }

  return { start, startControl, endControl, end, startNormal, endNormal }
}

function bezierMidpoint(geometry) {
  const x =
    (geometry.start.x + 3 * geometry.startControl.x + 3 * geometry.endControl.x + geometry.end.x) / 8
  const y =
    (geometry.start.y + 3 * geometry.startControl.y + 3 * geometry.endControl.y + geometry.end.y) / 8
  return { x: x, y: y }
}

/** Triangle with its tip on the node border, pointing inwards. */
function arrowPoints(tip, outwardNormal) {
  const baseX = tip.x + outwardNormal.x * ARROW_LENGTH
  const baseY = tip.y + outwardNormal.y * ARROW_LENGTH
  const perpX = -outwardNormal.y * ARROW_HALF_WIDTH
  const perpY = outwardNormal.x * ARROW_HALF_WIDTH
  return `${tip.x},${tip.y} ${baseX + perpX},${baseY + perpY} ${baseX - perpX},${baseY - perpY}`
}

function contentBounds(nodes) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }

  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY }
}

// -------------------------------------------------------------------- colors

function resolveColor(value) {
  if (!value) return null
  if (PRESET_COLORS[value]) return PRESET_COLORS[value]
  if (value.startsWith('#')) return value
  return null
}

// ------------------------------------------------------------- node contents

/** The scheme and host at the head of an absolute URL; everything after is path. */
const ABSOLUTE_URL_HEAD = /^https?:\/\/[^/]*/i

/**
 * Percent-encodes each segment but keeps the separators, and keeps an absolute
 * URL's scheme and host. Encoding the whole string in one go would escape the
 * slashes; leaving it alone would let a `#` in a file name cut the URL short.
 */
function encodePath(path) {
  const head = path.match(ABSOLUTE_URL_HEAD)
  const prefix = head === null ? '' : head[0]
  const segments = path.slice(prefix.length).split('/')
  return prefix + segments.map(encodeURIComponent).join('/')
}

/**
 * The URL of a file in the vault, or null when it leads to a host the page does
 * not load from. The root does not keep every file on its own host: an empty
 * root passes `https://host/x` through, and `/` turns `/host/x` into `//host/x`.
 */
function vaultUrl(path) {
  const url = encodePath(config.vaultRoot + path)
  if (!isAllowedSource(url)) return null
  return url
}

/**
 * A link into the note views carries the attachment folder, and the vault root
 * it sits under, so that a note read on its own finds its images where the
 * board does.
 */
function attachmentsQuery() {
  if (config.attachments === null) return ''

  const vault = encodeURIComponent(pathOnNotePage(config.vaultRoot))
  const attachments = encodeURIComponent(config.attachments)
  return `&vault=${vault}&attachments=${attachments}`
}

/**
 * The page a note link opens on: this one, when the board is the whole page,
 * or else the renderer's own page beside this module.
 */
function notePage() {
  return config.ownsPage ? '' : APP_URL.href
}

/**
 * A file's path, as the page that `notePage` names reads it. When the board is
 * mounted in another page, a relative path names a file beside that page, so
 * the link writes it from the site's root instead.
 */
function pathOnNotePage(path) {
  if (config.ownsPage) return path

  const pageFolder = new URL('./', window.location.href)
  const url = new URL(encodePath(path), pageFolder)
  if (url.origin !== window.location.origin) return path
  return decodeURIComponent(url.pathname)
}

function noteHref(path) {
  const notePath = encodeURIComponent(pathOnNotePage(path))
  return `${notePage()}?note=${notePath}${attachmentsQuery()}`
}

function rawHref(path) {
  const notePath = encodeURIComponent(pathOnNotePage(path))
  return `${notePage()}?raw=${notePath}${attachmentsQuery()}`
}

function fileExtension(path) {
  const dotIndex = path.lastIndexOf('.')
  const slashIndex = path.lastIndexOf('/')
  const dotInName = dotIndex > slashIndex
  if (!dotInName) return ''
  return path.slice(dotIndex + 1).toLowerCase()
}

function baseName(path) {
  const slashIndex = path.lastIndexOf('/')
  const withExtension = slashIndex < 0 ? path : path.slice(slashIndex + 1)
  return withExtension.replace(/\.md$/i, '')
}

/**
 * A relative image or link in markdown names a file beside the document it is
 * written in — the note, or the canvas for a text card — not beside this page.
 * The sanitized fragment is not in the page yet, so no image has been
 * requested from the wrong place.
 */
function resolveReferences(fragment, documentPath) {
  const baseUrl = new URL(encodePath(documentPath), window.location.href)
  for (const link of fragment.querySelectorAll('a[href]')) {
    const reference = link.getAttribute('href')
    if (reference.startsWith('#')) continue

    const resolved = URL.parse(reference, baseUrl)
    if (resolved === null) continue
    link.setAttribute('href', resolved.href)
  }
  // After the loop above, which would resolve their `?note=` against the document.
  for (const link of fragment.querySelectorAll('a.internal-link')) linkWikilink(link, documentPath)
  for (const image of fragment.querySelectorAll('img[src]')) loadImage(image, baseUrl)
}

/**
 * The file card a wikilink names: one whose path ends in the link's path, with
 * or without `.md`, ignoring case — the way Obsidian finds a note by its name
 * alone. Null when no card on the board holds it.
 */
function linkedCard(linkPath) {
  const wantedPaths = [linkPath, `${linkPath}.md`].map(path => `/${path.toLowerCase()}`)
  const isLinked = node => {
    if (node.type !== 'file') return false
    const file = `/${node.file.toLowerCase()}`
    return wantedPaths.some(wantedPath => file.endsWith(wantedPath))
  }
  return layout.nodes.find(isLinked) ?? null
}

/**
 * A wikilink to a note that has a card on the board fits the view to that card.
 * Any other opens the note on its own, looked for beside the document the link
 * is written in, as Obsidian looks first; a click with a modifier key opens the
 * link as the browser would. A link to a heading of its own document leads
 * nowhere.
 */
function linkWikilink(link, documentPath) {
  const linkPath = link.title.split('#')[0].trim()
  if (linkPath === '') return

  const notePath = fileExtension(linkPath) === 'md' ? linkPath : `${linkPath}.md`
  const path = directoryOf(documentPath) + notePath
  link.href = noteHref(path)
  link.addEventListener('click', event => {
    const hasModifier = event.metaKey || event.ctrlKey || event.shiftKey
    if (hasModifier) return
    const node = linkedCard(linkPath)
    if (node === null) return

    event.preventDefault()
    closeFileView()
    showCard(node)
  })
  // After the listener above, so that a card on the board wins.
  showOnPlainClick(link, () => openFile(path, 'note'))
}

/**
 * The URLs an image may load from, in the order they are tried. Obsidian links
 * a file by its name alone when no other file in the vault has that name, and
 * finds it wherever it sits. A browser cannot search a vault, so such a name is
 * tried first in the attachment folder, when the `attachments` parameter names
 * one, and then beside the document.
 */
function imageUrls(reference, baseUrl) {
  const resolved = URL.parse(reference, baseUrl)
  const besideDocument = resolved === null ? reference : resolved.href
  const isNameAlone = !reference.includes('/') && URL.parse(reference) === null
  if (config.attachments === null || !isNameAlone) return [besideDocument]

  const folderUrl = new URL(encodePath(config.vaultRoot + config.attachments), window.location.href)
  const inAttachments = new URL(reference, folderUrl)
  return [inAttachments.href, besideDocument]
}

/**
 * Loads an image from the first of its URLs that answers. An image that none of
 * them loads names itself instead: with no alt text, a broken image collapses
 * to nothing, and the note reads on as if nothing were missing.
 */
function loadImage(image, baseUrl) {
  const reference = image.getAttribute('src')
  const urls = imageUrls(reference, baseUrl)
  let tried = 0
  image.addEventListener('error', () => {
    tried += 1
    if (tried < urls.length) {
      image.src = urls[tried]
      return
    }

    const missingEl = document.createElement('span')
    missingEl.className = 'missing-image'
    missingEl.textContent = `Cannot load image ${reference}`
    image.replaceWith(missingEl)
  })
  image.src = urls[0]
}

function markdownElement(html, documentPath) {
  const el = document.createElement('div')
  el.className = 'markdown-preview'
  const fragment = DOMPurify.sanitize(html, SANITIZE_OPTIONS)
  resolveReferences(fragment, documentPath)
  el.append(fragment)
  return el
}

function placeholderElement(message) {
  const el = document.createElement('div')
  el.className = 'canvas-node-placeholder'
  el.textContent = message
  return el
}

/**
 * A host that sends no `Access-Control-Allow-Origin` makes `fetch` reject with
 * a bare `TypeError` before any status code exists — the likeliest way a remote
 * vault fails, and the one an HTTP status cannot describe. A response with an
 * HTTP error status throws too, naming the file as `name`.
 */
async function fetchFile(url, name) {
  let response = null
  try {
    response = await fetch(url)
  } catch (cause) {
    const reason = 'the host is unreachable, or sends no CORS header for this page'
    throw new Error(`Cannot reach ${url} — ${reason}`, { cause: cause })
  }
  if (!response.ok) throw new Error(`Cannot read ${name} (HTTP ${response.status})`)
  return response
}

async function loadMarkdownInto(contentEl, node) {
  const url = vaultUrl(node.file)
  const response = await fetchFile(url, node.file)

  const source = await response.text()
  const section = sliceSubpath(source, node.subpath)
  contentEl.replaceChildren(markdownElement(renderMarkdown(section), config.vaultRoot + node.file))
}

function fillFileNode(contentEl, node) {
  const url = vaultUrl(node.file)
  if (url === null) {
    const hosts = REMOTE_HOSTS.join(', ')
    const path = config.vaultRoot + node.file
    const message = `A file card loads a same-origin path or an https URL on ${hosts}, not ${path}`
    contentEl.replaceChildren(placeholderElement(message))
    return
  }

  const extension = fileExtension(node.file)

  if (IMAGE_EXTENSIONS.includes(extension)) {
    const image = document.createElement('img')
    image.className = 'canvas-node-image'
    image.src = url
    image.alt = node.file
    contentEl.dataset.fill = 'true'
    contentEl.replaceChildren(image)
    return
  }

  if (holdsEmbed(node)) {
    const frame = document.createElement('iframe')
    frame.className = 'canvas-node-embed'
    frame.src = url
    contentEl.dataset.fill = 'true'
    contentEl.replaceChildren(frame)
    return
  }

  contentEl.replaceChildren(placeholderElement('Loading…'))
  loadMarkdownInto(contentEl, node).catch(error => {
    contentEl.replaceChildren(placeholderElement(error.message))
  })
}

/**
 * The URL a link card frames and links to, or null for anything but a web
 * page: the frame and the title would run a `javascript:` URL in this page.
 */
function webUrl(url) {
  const parsed = URL.parse(url, window.location.href)
  if (parsed === null) return null

  const isWebPage = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  if (!isWebPage) return null
  return parsed.href
}

function fillLinkNode(contentEl, node) {
  const url = webUrl(node.url)
  if (url === null) {
    contentEl.replaceChildren(placeholderElement(`A link card shows an http or https URL, not ${node.url}`))
    return
  }

  const frame = document.createElement('iframe')
  frame.className = 'canvas-node-embed'
  frame.sandbox = LINK_FRAME_SANDBOX
  frame.src = url
  frame.loading = 'lazy'
  frame.referrerPolicy = 'no-referrer'
  contentEl.dataset.fill = 'true'
  contentEl.replaceChildren(frame)
}

// -------------------------------------------------------------- node element

/** Obsidian heads a file or link card with the file name, inside the card. */
function nodeTitleText(node) {
  if (node.type === 'file') return baseName(node.file)
  return node.url
}

/** lucide `external-link`: the title opens a separate tab. */
const EXTERNAL_LINK_ICON =
  '<path d="M15 3h6v6"/><path d="M10 14 21 3"/>' +
  '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>'

/** lucide `code`: the familiar mark for "show me the source". */
const SOURCE_ICON = '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'

function createIcon(paths) {
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

function createTitleLink(href, tooltip) {
  const linkEl = document.createElement('a')
  linkEl.className = 'canvas-node-title-link'
  linkEl.href = href
  linkEl.target = '_blank'
  linkEl.rel = 'noopener'
  linkEl.title = tooltip
  return linkEl
}

/**
 * Two destinations per note card: the title text reads the note, the icon
 * beside it shows the markdown source. Both go through this page's own views
 * rather than straight at the `.md`, so the text stays correct whatever media
 * type the host serves markdown as. Those views read a file as text, so the
 * title of any other file — an image, a PDF — opens the file itself.
 */
function createTitleElement(node) {
  const titleEl = document.createElement('div')
  titleEl.className = 'canvas-node-title'

  const textEl = document.createElement('span')
  textEl.className = 'canvas-node-title-text'
  textEl.textContent = nodeTitleText(node)

  // A card names a URL it refuses, with nothing to follow.
  const isLink = node.type === 'link'
  const url = isLink ? webUrl(node.url) : vaultUrl(node.file)
  if (url === null) {
    titleEl.appendChild(textEl)
    return titleEl
  }

  // Each anchor is inline-sized, so only its own text and icon are clickable —
  // not the empty remainder of the title row.
  const isNote = !isLink && fileExtension(node.file) === 'md'
  let primaryEl = null
  if (isLink) {
    primaryEl = createTitleLink(url, `Open ${node.url}`)
  } else if (isNote) {
    primaryEl = createTitleLink(noteHref(config.vaultRoot + node.file), `Read ${node.file}`)
    showOnPlainClick(primaryEl, () => openFile(config.vaultRoot + node.file, 'note'))
  } else {
    primaryEl = createTitleLink(url, `Open ${node.file}`)
  }

  primaryEl.append(textEl, createIcon(EXTERNAL_LINK_ICON))
  titleEl.appendChild(primaryEl)

  if (!isNote) return titleEl

  const sourceEl = createTitleLink(rawHref(config.vaultRoot + node.file), `View source of ${node.file}`)
  sourceEl.classList.add('canvas-node-source-link')
  showOnPlainClick(sourceEl, () => openFile(config.vaultRoot + node.file, 'raw'))
  sourceEl.appendChild(createIcon(SOURCE_ICON))
  titleEl.appendChild(sourceEl)
  return titleEl
}

/**
 * Text nodes are commonly written title first, so the first line becomes the
 * card's header — but only when it is a paragraph in its own right. A line that
 * opens a list, a quote, a fence or a heading belongs to what follows it, and
 * lifting it out would leave both halves wrong. marked decides which, so the
 * header agrees with how the card renders.
 */
function splitTextNode(text) {
  const source = text || ''
  const lines = source.split('\n')
  const firstLine = lines[0].trim()
  const body = lines.slice(1).join('\n')

  const wholeCardWouldBeHeader = body.trim() === ''
  if (firstLine === '' || wholeCardWouldBeHeader) return { header: null, body: source }
  const firstBlock = markdownParser.lexer(source)[0]
  if (firstBlock.type !== 'paragraph') return { header: null, body: source }

  return { header: firstLine, body: body }
}

/**
 * The promoted line, drawn as a filled strip. A file card's title row is
 * transparent and holds links to the note, so the two headers stay apart at a
 * glance: this one is the card's own first sentence, not a name to click.
 */
function createTextHeaderElement(line) {
  const headerEl = document.createElement('div')
  headerEl.className = 'canvas-node-header'
  headerEl.appendChild(markdownElement(renderMarkdown(line), config.canvasPath))
  return headerEl
}

/** Group frames carry their name above the frame; nothing sits inside them. */
function createGroupLabelElement(node) {
  const labelEl = document.createElement('div')
  labelEl.className = 'canvas-node-label'
  labelEl.textContent = node.label
  return labelEl
}

/** JSON Canvas backgroundStyle values. A group that names none of them is drawn as `cover`. */
const BACKGROUND_STYLES = ['cover', 'ratio', 'repeat']

/**
 * A group's background image fills its frame as its backgroundStyle names:
 * `cover` crops the image to fill the frame, `ratio` shows the whole image at
 * its own proportions, and `repeat` tiles it at its own size.
 */
function applyGroupBackground(el, node) {
  const url = vaultUrl(node.background)
  if (url === null) {
    const hosts = REMOTE_HOSTS.join(', ')
    const path = config.vaultRoot + node.background
    console.warn(`group ${node.id}: a background loads from a same-origin path or an https URL on ${hosts}, not ${path}`)
    return
  }

  // vaultUrl percent-encodes every path segment, so no quote in it ends the CSS string.
  el.style.backgroundImage = `url("${url}")`
  const isKnownStyle = BACKGROUND_STYLES.includes(node.backgroundStyle)
  el.dataset.backgroundStyle = isKnownStyle ? node.backgroundStyle : 'cover'
}

function createNodeElement(node) {
  const el = document.createElement('div')
  el.className = 'canvas-node'
  el.dataset.type = node.type
  el.style.left = `${node.x}px`
  el.style.top = `${node.y}px`
  applyNodeSize(el, node)

  const color = resolveColor(node.color)
  if (color) {
    el.style.setProperty('--node-color', color)
    el.dataset.colored = 'true'
  }

  if (node.type === 'group') {
    if (node.label) el.appendChild(createGroupLabelElement(node))
    if (node.background) applyGroupBackground(el, node)
    return el
  }

  if (node.type === 'file' || node.type === 'link') el.appendChild(createTitleElement(node))

  const text = node.type === 'text' ? splitTextNode(node.text) : null
  if (text !== null && text.header !== null) el.appendChild(createTextHeaderElement(text.header))

  const contentEl = document.createElement('div')
  contentEl.className = 'canvas-node-content'
  el.appendChild(contentEl)

  if (node.type === 'text') {
    contentEl.replaceChildren(markdownElement(renderMarkdown(text.body), config.canvasPath))
  } else if (node.type === 'file') {
    fillFileNode(contentEl, node)
  } else if (node.type === 'link') {
    fillLinkNode(contentEl, node)
  } else {
    contentEl.replaceChildren(placeholderElement(`Unsupported node type: ${node.type}`))
  }

  return el
}

// -------------------------------------------------------------- edge element

function createEdgeArrow() {
  const arrow = document.createElementNS(SVG_NAMESPACE, 'polygon')
  arrow.setAttribute('class', 'canvas-edge-arrow')
  return arrow
}

/**
 * Builds the group and its children with no coordinates in them, and returns
 * the record `layoutEdge` writes those into. Holding on to the child elements
 * is what spares a moved node a DOM query per pointer move.
 */
function createEdgeElements(edge, fromNode, toNode) {
  const group = document.createElementNS(SVG_NAMESPACE, 'g')
  const color = resolveColor(edge.color)
  if (color) group.style.setProperty('--edge-color', color)

  const path = document.createElementNS(SVG_NAMESPACE, 'path')
  path.setAttribute('class', 'canvas-edge-line')
  group.appendChild(path)

  // Spec default: no arrow at the source, an arrow at the target.
  const startArrow = edge.fromEnd === 'arrow' ? createEdgeArrow() : null
  const endArrow = edge.toEnd === 'none' ? null : createEdgeArrow()
  if (startArrow) group.appendChild(startArrow)
  if (endArrow) group.appendChild(endArrow)

  let label = null
  if (edge.label) {
    label = document.createElementNS(SVG_NAMESPACE, 'text')
    label.setAttribute('class', 'canvas-edge-label')
    label.textContent = edge.label
    group.appendChild(label)
  }

  return { group, edge, fromNode, toNode, path, startArrow, endArrow, label }
}

/** Writes the geometry the endpoints' current positions imply into an existing edge. */
function layoutEdge(record) {
  const { edge, fromNode, toNode } = record
  const fromSide = edge.fromSide || inferSide(fromNode, toNode)
  const toSide = edge.toSide || inferSide(toNode, fromNode)
  const geometry = edgeGeometry(fromNode, fromSide, toNode, toSide)

  const { start, startControl, endControl, end } = geometry
  record.path.setAttribute(
    'd',
    `M ${start.x} ${start.y} C ${startControl.x} ${startControl.y}, ${endControl.x} ${endControl.y}, ${end.x} ${end.y}`,
  )

  if (record.startArrow) {
    record.startArrow.setAttribute('points', arrowPoints(start, geometry.startNormal))
  }
  if (record.endArrow) {
    record.endArrow.setAttribute('points', arrowPoints(end, geometry.endNormal))
  }

  if (!record.label) return
  const midpoint = bezierMidpoint(geometry)
  record.label.setAttribute('x', midpoint.x)
  record.label.setAttribute('y', midpoint.y)
}

// ------------------------------------------------------------------ viewport

let shownZoomLabel = ''

function applyView() {
  canvasEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`

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

  scheduleViewUrl()

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

/**
 * Fits the bounds into the viewport, at zoom 1 at most, and remembers what was
 * fitted: the whole board, or the one node passed in.
 */
function fitToContent(bounds, node = null) {
  const rect = wrapperEl.getBoundingClientRect()
  const contentWidth = bounds.maxX - bounds.minX
  const contentHeight = bounds.maxY - bounds.minY

  // A viewport smaller than the padding still gets a scale above zero.
  const availableWidth = Math.max(rect.width - FIT_PADDING * 2, 1)
  const availableHeight = Math.max(rect.height - FIT_PADDING * 2, 1)
  const scaleX = availableWidth / Math.max(contentWidth, 1)
  const scaleY = availableHeight / Math.max(contentHeight, 1)
  const scale = Math.min(scaleX, scaleY, FIT_MAX_ZOOM)

  view.zoom = scale
  // A card fitted on its own leaves the floor where the board's fit put it.
  if (node === null) zoomFloor = Math.min(MIN_ZOOM, scale)
  view.x = rect.width / 2 - (bounds.minX + contentWidth / 2) * view.zoom
  view.y = rect.height / 2 - (bounds.minY + contentHeight / 2) * view.zoom
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
  const nodes = node === null ? layout.nodes : [node]
  fitToContent(contentBounds(nodes), node)
}

/** The card a press or a search put the focus on, or null while the focus is on the board. */
let focusedCardEl = null

/**
 * A press decides what the wheel drives from then on: a card, or the board.
 * Without that, a card sliding under a still pointer during a wheel pan would
 * take the rest of the gesture over, which is what a reader paging through a
 * board never means.
 *
 * The controls are neither: pressing one leaves the focus where the reader put it.
 */
function focusOnPress(target) {
  if (!(target instanceof Element)) return
  if (target.closest('.canvas-controls') !== null) return

  focusCard(target.closest('.canvas-node'))
}

/** Puts the focus on a card, or on the board for null, and marks the card that holds it. */
function focusCard(cardEl) {
  if (cardEl === focusedCardEl) return

  if (focusedCardEl !== null) delete focusedCardEl.dataset.focused
  focusedCardEl = cardEl
  if (cardEl !== null) cardEl.dataset.focused = 'true'
}

/** Fits the view to one card, and puts the focus on it as a press on it would. */
function showCard(node) {
  fitToContent(contentBounds([node]), node)
  focusCard(layout.elements.get(node.id))
}

/** A wheel scrolls a card's content only over the card the focus is on. */
function wheelScrollsCard(target) {
  if (focusedCardEl === null) return false
  if (!(target instanceof Element)) return false

  const contentEl = target.closest('.canvas-node-content')
  if (contentEl === null) return false
  return contentEl.closest('.canvas-node') === focusedCardEl
}

/**
 * Card content scrolls and selects text, a card title is a link, and the
 * controls are buttons: a press on any of them neither pans the viewport nor
 * drags the card it belongs to.
 *
 * Leaving the controls out of this would make them unclickable rather than
 * merely draggable: the pan captures the pointer, capture retargets the mouse
 * events a click is derived from, and the button never sees the click.
 */
function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false
  return target.closest('.canvas-node-content, .canvas-node-title-link, .canvas-controls') !== null
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
      // A trackpad pinch arrives as a wheel event with ctrlKey set.
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const factor = Math.exp(-event.deltaY / ZOOM_WHEEL_SENSITIVITY)
        // A board mounted in a page need not start at the window's corner.
        const rect = wrapperEl.getBoundingClientRect()
        zoomAt(event.clientX - rect.left, event.clientY - rect.top, view.zoom * factor)
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
  // Recomputed at click time: a drag leaves the bounds captured at load stale.
  zoomFitEl.addEventListener('click', () => fitToContent(contentBounds(layout.nodes)))

  // A resized window refits the view, unless the reader has moved it since the
  // fit; a moved view keeps its corner, so the address bar takes its new centre.
  const observer = new ResizeObserver(() => {
    refitView()
    scheduleViewUrl()
  })
  observer.observe(wrapperEl)
}

// --------------------------------------------------------------- address bar

/** `at=<x>,<y>,<zoom>`: three decimal numbers, the zoom without a sign. */
const AT_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/

/**
 * The view the `at` parameter names, or null without one: the canvas point at
 * the centre of the viewport, and the zoom. A centre rather than a corner keeps
 * a link on the same spot in a window of another size.
 */
function requestedCentre(params) {
  const value = params.get('at')
  if (value === null) return null

  const match = AT_PATTERN.exec(value)
  if (match === null) throw new Error(`the at parameter accepts <x>,<y>,<zoom>, got ${value}`)
  const [x, y, zoom] = match.slice(1).map(Number)
  return { x: x, y: y, zoom: zoom }
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

/** Fits the view to the card `focus` names, or says that the board holds no such card. */
function showRequestedCard(id) {
  const node = layout.nodes.find(node => node.id === id)
  if (node === undefined) {
    showStatus(`the focus parameter accepts the id of a card on this board, got ${id}`)
    return
  }
  showCard(node)
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
  if (viewIsAsFitted()) {
    const node = fittedView.node
    if (node === null) return null
    return `focus=${encodeURIComponent(node.id)}`
  }

  const rect = wrapperEl.getBoundingClientRect()
  const centreX = (rect.width / 2 - view.x) / view.zoom
  const centreY = (rect.height / 2 - view.y) / view.zoom
  const zoom = Number(view.zoom.toPrecision(3))
  return `at=${Math.round(centreX)},${Math.round(centreY)},${zoom}`
}

/**
 * Rewrites `at` and `focus` in the address bar to the view, and keeps every
 * other parameter as it was typed: URLSearchParams would encode the slashes in
 * `canvas` and the commas in `at`.
 */
function writeViewUrl() {
  const pairs = window.location.search.slice(1).split('&')
  const parameters = pairs.filter(pair => {
    const name = pair.split('=')[0]
    return name !== '' && name !== 'at' && name !== 'focus'
  })
  const viewPair = viewParameter()
  if (viewPair !== null) parameters.push(viewPair)

  const search = parameters.length === 0 ? '' : `?${parameters.join('&')}`
  if (search === window.location.search) return
  history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`)
}

// ------------------------------------------------------------------ dragging

/**
 * What a press on this node moves. Obsidian carries a group's contents with the
 * frame, and the file format records no membership, so a group takes every node
 * whose box lies inside its own — fixed when the drag starts, so a node the
 * frame merely passes over is not picked up along the way.
 */
function movedNodes(node) {
  if (node.type !== 'group') return [node]

  const contained = layout.nodes.filter(other => {
    if (other === node) return false
    const insideX = other.x >= node.x && other.x + other.width <= node.x + node.width
    const insideY = other.y >= node.y && other.y + other.height <= node.y + node.height
    return insideX && insideY
  })
  return [node].concat(contained)
}

/** Re-routes every edge attached to a node whose box has just changed. */
function relayoutNodeEdges(node) {
  const attached = layout.edgesByNode.get(node.id)
  if (!attached) return
  for (const record of attached) layoutEdge(record)
}

/** Moves a node in the data and in the DOM, and re-routes the edges attached to it. */
function placeNode(node, x, y) {
  node.x = x
  node.y = y

  const el = layout.elements.get(node.id)
  el.style.left = `${x}px`
  el.style.top = `${y}px`

  relayoutNodeEdges(node)
}

/**
 * Resizes a node in the data and in the DOM, and re-routes the edges attached
 * to it. A card whose height was following its content stops following it: the
 * reader has just said how tall the card is to be. Pressing a card size puts
 * the whole board back under that size.
 */
function sizeNode(node, width, height) {
  node.width = width
  node.height = height

  const el = layout.elements.get(node.id)
  el.style.width = `${width}px`
  el.style.height = `${height}px`
  el.style.maxHeight = `${height}px`
  delete el.dataset.sized

  relayoutNodeEdges(node)
}

/** From here on the reader arranges the board, so nothing re-fits the view for them. */
function releaseAutoFit() {
  fittedView = null
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

/** The grid line nearest a canvas coordinate. */
function nearestGridLine(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
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
    resizeEdgeLayer(contentBounds(layout.nodes))
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
    resizeEdgeLayer(contentBounds(layout.nodes))
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

// ----------------------------------------------------------------- card size

/**
 * A link, and a file the browser can only frame, are drawn in an iframe, which
 * has no height of its own: such a card cannot be sized by its content, and is
 * given the cap as its height instead.
 */
function holdsEmbed(node) {
  if (node.type === 'link') return true
  if (node.type !== 'file') return false

  const extension = fileExtension(node.file)
  if (extension === 'md') return false
  return !IMAGE_EXTENSIONS.includes(extension)
}

/**
 * Sizes one card. `actual` restores the size the file authored; the other modes
 * fix the width for the whole board and leave the height to the content, capped.
 * A group keeps its authored size in every mode: a frame marks out a region of
 * the board rather than holding content that could size it.
 *
 * The node data is rewritten to match, because edge anchors, group membership
 * and the fit all read a node's box out of it. Nothing is written back to the
 * file, so a reload restores the authored sizes.
 */
function applyNodeSize(el, node) {
  const size = CARD_SIZES[config.cardSize]
  const authored = layout.authoredSizes.get(node.id)
  const keepsAuthoredSize = size.width === null || node.type === 'group'

  // The cap is written even where nothing is capped, so that it is always a
  // length: a card whose content overruns the cap takes its height from it, and
  // `none` is not a value the browser can ease away from.
  if (keepsAuthoredSize) {
    node.width = authored.width
    node.height = authored.height
    el.style.width = `${authored.width}px`
    el.style.height = `${authored.height}px`
    el.style.maxHeight = `${authored.height}px`
    delete el.dataset.sized
    return
  }

  node.width = size.width
  el.style.width = `${size.width}px`
  el.style.maxHeight = `${size.maxHeight}px`

  if (holdsEmbed(node)) {
    node.height = size.maxHeight
    el.style.height = `${size.maxHeight}px`
    delete el.dataset.sized
    return
  }

  el.style.height = 'auto'
  el.dataset.sized = 'content'
}

/** Copies the size a card was laid out at into its node data, and tells whether it changed. */
function recordCardSize(node) {
  const el = layout.elements.get(node.id)
  const width = el.offsetWidth
  const height = el.offsetHeight
  const changed = width !== node.width || height !== node.height
  node.width = width
  node.height = height
  return changed
}

/**
 * One read pass, after every card has been written: the browser lays out once,
 * and the size each card settled on goes back into the node data, which the
 * edges, the edge layer and the fit are all computed from.
 */
function readCardSizes() {
  for (const node of layout.nodes) recordCardSize(node)
}

/**
 * Re-routes each edge attached to these resized nodes once, after all of them
 * hold their new box, so an edge between two of them is routed with both. Then
 * fits the edge layer to the board, and returns the board's bounds for the fit.
 */
function relayoutAfterResize(nodes) {
  const records = new Set()
  for (const node of nodes) {
    const attached = layout.edgesByNode.get(node.id) ?? []
    for (const record of attached) records.add(record)
  }
  for (const record of records) layoutEdge(record)

  const bounds = contentBounds(layout.nodes)
  resizeEdgeLayer(bounds)
  return bounds
}

/** The node each observed card element draws. */
const observedNodes = new WeakMap()

/**
 * A content-sized card knows its height only once the browser has laid it out,
 * again whenever a note, an image or a formula lands, and on every frame of the
 * transition that eases it into a new size. One observer watches every card, so
 * the cards resized in one frame are handled together: their node data follows
 * the elements, and everything computed from the boxes is redone once —
 * including the fit, for as long as the view is still the one this page fitted.
 */
const cardSizeObserver = new ResizeObserver(entries => {
  const resized = []
  for (const entry of entries) {
    const node = observedNodes.get(entry.target)
    const changed = recordCardSize(node)
    if (changed) resized.push(node)
  }
  if (resized.length === 0) return

  relayoutAfterResize(resized)
  refitView()
})

function observeCardSize(el, node) {
  observedNodes.set(el, node)
  cardSizeObserver.observe(el)
}

/** Shows which of the three sizes the board is drawn at. */
function markCardSizeControl(sizeName) {
  for (const el of cardSizeEls) {
    el.setAttribute('aria-pressed', String(el.dataset.cardSize === sizeName))
  }
}

/**
 * Re-draws every card at the named size, then re-routes the edges and refits.
 * Cards ease into the new size rather than snap to it, so these are the sizes
 * they are heading for; `observeCardSize` follows the transition frame by frame
 * and brings the edges, the layer and the fit along with it.
 */
function applyCardSize(sizeName) {
  config.cardSize = sizeName
  localStorage.setItem(CARD_SIZE_STORAGE_KEY, sizeName)
  markCardSizeControl(sizeName)

  for (const node of layout.nodes) applyNodeSize(layout.elements.get(node.id), node)
  readCardSizes()
  const bounds = relayoutAfterResize(layout.nodes)
  fitToContent(bounds)
}

/** The `cards` parameter names a size for one page load; the control persists a choice. */
function preferredCardSize(params) {
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

function installCardSizeControl() {
  markCardSizeControl(config.cardSize)
  for (const el of cardSizeEls) {
    // Pressing the size already in force puts cards resized by hand back under it.
    el.addEventListener('click', () => applyCardSize(el.dataset.cardSize))
  }
}

// -------------------------------------------------------------------- search

/** What a search result calls a card: the name or label it shows, or its first line. */
function cardName(node) {
  if (node.type === 'file' || node.type === 'link') return nodeTitleText(node)
  if (node.type === 'group') return node.label ?? ''
  if (node.type === 'text') return node.text.trim().split('\n')[0]
  return ''
}

/** The markdown a card shows, as text: a note once it has loaded, or a text card's header and body. */
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
  for (const node of layout.nodes) {
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
  showCard(node)
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
 * Enter for the first, fits the view to it. A press anywhere else closes the
 * list and keeps the query, so a click in the box brings the list back.
 */
function installSearch() {
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

/** The SVG layer keeps a margin around the nodes so bowed edges are not clipped. */
function resizeEdgeLayer(bounds) {
  const layerX = bounds.minX - EDGE_LAYER_MARGIN
  const layerY = bounds.minY - EDGE_LAYER_MARGIN
  const layerWidth = bounds.maxX - bounds.minX + EDGE_LAYER_MARGIN * 2
  const layerHeight = bounds.maxY - bounds.minY + EDGE_LAYER_MARGIN * 2

  edgesEl.style.left = `${layerX}px`
  edgesEl.style.top = `${layerY}px`
  edgesEl.setAttribute('width', layerWidth)
  edgesEl.setAttribute('height', layerHeight)
  edgesEl.setAttribute('viewBox', `${layerX} ${layerY} ${layerWidth} ${layerHeight}`)
}

/** Lists the edge under both its endpoints, so a moved node finds what to re-route. */
function indexEdge(record) {
  for (const node of [record.fromNode, record.toNode]) {
    const attached = layout.edgesByNode.get(node.id)
    if (attached) attached.push(record)
    else layout.edgesByNode.set(node.id, [record])
  }
}

function isJsonObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The string field each node type draws from, as JSON Canvas names it. */
const CONTENT_FIELDS = new Map([['text', 'text'], ['file', 'file'], ['link', 'url']])

/** Throws when a node lacks a field that drawing reads, naming the node and the field. */
function validateNode(node, index) {
  if (!isJsonObject(node)) throw new TypeError(`node ${index} is not a JSON object`)
  if (typeof node.id !== 'string') throw new TypeError(`node ${index} needs a string in "id"`)

  const name = `node "${node.id}"`
  if (typeof node.type !== 'string') throw new TypeError(`${name} needs a string in "type"`)
  for (const field of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(node[field])) throw new TypeError(`${name} needs a number in "${field}"`)
  }

  const contentField = CONTENT_FIELDS.get(node.type)
  if (contentField === undefined) return
  if (typeof node[contentField] !== 'string') throw new TypeError(`${name} needs a string in "${contentField}"`)
}

function drawCanvas(data) {
  if (!isJsonObject(data)) throw new TypeError('canvas file is not a JSON object')

  // JSON Canvas makes both arrays optional, so `{}` is an empty board.
  const nodes = data.nodes ?? []
  if (!Array.isArray(nodes)) throw new TypeError('canvas file has a "nodes" field that is not an array')
  const edges = data.edges ?? []
  if (!Array.isArray(edges)) throw new TypeError('canvas file has an "edges" field that is not an array')

  // Every check runs before anything is drawn, so a broken file draws nothing.
  const nodesById = new Map()
  for (const [index, node] of nodes.entries()) {
    validateNode(node, index)
    if (nodesById.has(node.id)) throw new TypeError(`two nodes have the id "${node.id}"`)
    nodesById.set(node.id, node)
  }
  for (const [index, edge] of edges.entries()) {
    if (!isJsonObject(edge)) throw new TypeError(`edge ${index} is not a JSON object`)
  }

  layout.nodes = nodes
  for (const node of nodes) {
    layout.authoredSizes.set(node.id, { width: node.width, height: node.height })
  }

  // Groups first so they sit behind; within each class the file order is the z-order.
  const groups = nodes.filter(node => node.type === 'group')
  const others = nodes.filter(node => node.type !== 'group')
  for (const node of groups.concat(others)) {
    const el = createNodeElement(node)
    layout.elements.set(node.id, el)
    installNodeDrag(node, el)
    installNodeResize(node, el)
    observeCardSize(el, node)
    canvasEl.appendChild(el)
  }

  readCardSizes()
  resizeEdgeLayer(contentBounds(nodes))

  for (const edge of edges) {
    const fromNode = nodesById.get(edge.fromNode)
    const toNode = nodesById.get(edge.toNode)
    if (!fromNode || !toNode) {
      console.warn(`edge ${edge.id} references a missing node`, edge)
      continue
    }

    const record = createEdgeElements(edge, fromNode, toNode)
    layoutEdge(record)
    edgesEl.appendChild(record.group)
    indexEdge(record)
  }
}

// ----------------------------------------------------------------- bootstrap

function showStatus(message) {
  statusEl.textContent = message
  statusEl.hidden = false
}

/**
 * Content may come from this page's own origin, or over https from a host in
 * `REMOTE_HOSTS`. Any other host, and any other scheme — `data:`, `javascript:`
 * — is either a configuration mistake or an attempt to run foreign script here.
 */
function isAllowedSource(path) {
  const url = URL.parse(path, window.location.href)
  if (url === null) return false

  const isSameProtocol = url.protocol === window.location.protocol
  const isSameHost = url.host === window.location.host
  if (isSameProtocol && isSameHost) return true

  const isHttps = url.protocol === 'https:'
  const isAllowedHost = REMOTE_HOSTS.includes(url.hostname)
  return isHttps && isAllowedHost
}

function assertAllowedHost(path, parameterName) {
  if (isAllowedSource(path)) return

  const hosts = REMOTE_HOSTS.join(', ')
  throw new Error(
    `the ${parameterName} parameter accepts a same-origin path or an https URL on ${hosts}, got ${path}`,
  )
}

function directoryOf(path) {
  const slashIndex = path.lastIndexOf('/')
  if (slashIndex < 0) return ''
  return path.slice(0, slashIndex + 1)
}

/**
 * File nodes store paths relative to the vault root. `vault` names that root;
 * left out, it is the directory holding the canvas file — which is where the
 * root sits whenever a canvas is deployed together with the notes it embeds.
 * The note views default to the note's own directory the same way.
 */
function resolveVaultRoot(params, documentPath) {
  const explicitRoot = params.get('vault')
  if (explicitRoot === null) return directoryOf(documentPath)

  assertAllowedHost(explicitRoot, 'vault')
  if (explicitRoot === '') return ''
  if (explicitRoot.endsWith('/')) return explicitRoot
  return `${explicitRoot}/`
}

/**
 * The folder Obsidian puts new attachments in, under the vault root, as its
 * "Default location for new attachments" setting names it; null when the
 * `attachments` parameter names none.
 */
function resolveAttachments(params) {
  const folder = params.get('attachments')
  if (folder === null) return null

  assertAllowedHost(config.vaultRoot + folder, 'attachments')
  if (folder === '') return ''
  if (folder.endsWith('/')) return folder
  return `${folder}/`
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

  if (config.ownsPage) document.title = path
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

async function main(params) {
  installThemeToggles()
  installFileView()
  // A single newline is a line break, as in Obsidian with "Strict line breaks" off.
  markdownParser = new marked.Marked({ gfm: true, breaks: true, extensions: MARKDOWN_EXTENSIONS })

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

  showStatus(`Loading ${canvasPath} …`)
  const response = await fetchFile(encodePath(canvasPath), canvasPath)

  const data = await response.json().catch(cause => {
    throw new Error(`Cannot parse ${canvasPath}: ${cause.message}`, { cause: cause })
  })
  statusEl.hidden = true

  drawCanvas(data)
  fitToContent(contentBounds(layout.nodes))
  // A link that names a view opens on it in place of the fit, `focus` over `at`.
  if (centre !== null) centreView(centre)
  const focusId = params.get('focus')
  if (focusId !== null) showRequestedCard(focusId)
  installViewportControls()
  installCardSizeControl()
  installSearch()
  installGridSnapControl()
}

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
  config.ownsPage = params === undefined
  const query = config.ownsPage ? window.location.search : params
  try {
    await loadAssets(shadowRoot)
    shadowRoot.append(boardFragment)
    await main(new URLSearchParams(query))
  } catch (error) {
    // The markup waits for its stylesheets, so a failed load has left it out.
    shadowRoot.append(boardFragment)
    showStatus(String(error.message || error))
    throw error
  }
}
