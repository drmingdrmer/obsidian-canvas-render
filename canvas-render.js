'use strict'

/**
 * Renders a JSON Canvas file (https://jsoncanvas.org) the way Obsidian draws it:
 * nodes are absolutely positioned DOM elements, edges are one SVG layer beneath
 * them, and the whole thing sits in a pan/zoom viewport over a dot grid.
 */

// ---------------------------------------------------------------- constants

const DEFAULT_CANVAS_PATH = 'vault/demo.canvas'
const THEME_STORAGE_KEY = 'canvas-render-theme'
const CARD_SIZE_STORAGE_KEY = 'canvas-render-card-size'

/**
 * What the card-size control offers, in the order it cycles through them.
 * `actual` draws every card at the size its file gives it. The other two ignore
 * that size, fix one width for the whole board and let the content set the
 * height, up to a cap that keeps a long note from towering over the rest.
 */
const CARD_SIZES = {
  actual: { label: 'Actual', width: null, maxHeight: null },
  wide: { label: 'Wide', width: 520, maxHeight: 480 },
  compact: { label: 'Compact', width: 320, maxHeight: 240 },
}

const CARD_SIZE_NAMES = Object.keys(CARD_SIZES)

/**
 * Hosts besides this page's own origin that a canvas, a vault or a note may be
 * loaded from. Rendered markdown reaches the DOM through `innerHTML` and marked
 * passes raw HTML through untouched, so a host listed here can run script in
 * this page's origin — extending the list is a trust decision.
 */
const REMOTE_HOSTS = ['raw.githubusercontent.com']

const GRID_SIZE = 20
const MIN_ZOOM = 0.1
const MAX_ZOOM = 3
const ZOOM_STEP = 1.15
const FIT_PADDING = 60
const FIT_MAX_ZOOM = 1

/** Wheel delta that doubles the zoom, divided by ln 2. Larger means gentler. */
const ZOOM_WHEEL_SENSITIVITY = 400

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

const wrapperEl = document.getElementById('wrapper')
const backgroundEl = document.getElementById('background')
const canvasEl = document.getElementById('canvas')
const edgesEl = document.getElementById('edges')
const statusEl = document.getElementById('status')
const zoomInEl = document.getElementById('zoom-in')
const zoomOutEl = document.getElementById('zoom-out')
const zoomResetEl = document.getElementById('zoom-reset')
const zoomFitEl = document.getElementById('zoom-fit')
const cardSizeEl = document.getElementById('card-size')
const themeToggleEls = document.querySelectorAll('.theme-toggle')
const fileViewEl = document.getElementById('file-view')
const fileViewPathEl = document.getElementById('file-view-path')
const fileViewToggleEl = document.getElementById('file-view-toggle')
const fileViewBodyEl = document.getElementById('file-view-body')

// --------------------------------------------------------------------- state

/** Screen position of canvas origin, plus the current scale factor. */
const view = { x: 0, y: 0, zoom: 1 }

/** The view as `fitToContent` last left it; a pan or a zoom by the reader makes it stale. */
let fittedView = null

/** Read from the URL query at startup; the card size then follows its control. */
const config = { vaultRoot: '', cardSize: 'actual' }

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
  document.documentElement.dataset.theme = theme
  const glyph = theme === 'dark' ? '☀' : '☾'
  for (const toggleEl of themeToggleEls) toggleEl.textContent = glyph
  localStorage.setItem(THEME_STORAGE_KEY, theme)
}

/** Every view carries a toggle, so the wiring cannot live with the canvas controls. */
function installThemeToggles() {
  applyTheme(preferredTheme())
  for (const toggleEl of themeToggleEls) {
    toggleEl.addEventListener('click', () => {
      const isDark = document.documentElement.dataset.theme === 'dark'
      applyTheme(isDark ? 'light' : 'dark')
    })
  }
}

// ------------------------------------------------------------------ markdown

/**
 * One scan that recognises, in priority order: code (fenced or inline), display
 * math, inline math, wikilink. Code wins so that `$x$` inside backticks stays
 * literal, exactly as Obsidian treats it.
 */
const INLINE_SCAN =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|\$\$([\s\S]+?)\$\$|\$((?:[^$\\\n]|\\.)+?)\$|\[\[([^[\]]+?)\]\]/g

const MATH_PLACEHOLDER_PREFIX = 'CANVASMATH'
const MATH_PLACEHOLDER_SUFFIX = 'ENDMATH'

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

/** `[[target|alias]]` and `[[target#heading]]` become a non-navigable link, as in an export. */
function wikilinkToHtml(body) {
  const pipeIndex = body.indexOf('|')
  const hasAlias = pipeIndex >= 0
  const target = hasAlias ? body.slice(0, pipeIndex) : body
  const alias = hasAlias ? body.slice(pipeIndex + 1) : body.replace(/^.*?#/, '')
  const label = alias.trim() === '' ? target.trim() : alias.trim()
  return `<a class="internal-link is-unresolved" title="${escapeHtml(target.trim())}">${escapeHtml(label)}</a>`
}

/** True when the match occupies whole lines, so replacing it cannot disturb a paragraph. */
function ownsItsLines(source, offset, length) {
  const before = source.slice(0, offset)
  const after = source.slice(offset + length)
  const startsLine = before === '' || before.endsWith('\n')
  const endsLine = after === '' || after.startsWith('\n')
  return startsLine && endsLine
}

/** Pulls math out of the source so marked cannot mangle `_`, `*` and `\` inside it. */
function extractInline(source) {
  const mathItems = []

  const replaced = source.replace(INLINE_SCAN, (match, code, display, inline, wikilink, offset) => {
    if (code !== undefined) return code

    if (wikilink !== undefined) return wikilinkToHtml(wikilink)

    const isDisplay = display !== undefined
    const body = isDisplay ? display : inline
    mathItems.push({ body: body, display: isDisplay })
    const index = mathItems.length - 1
    const placeholder = `${MATH_PLACEHOLDER_PREFIX}${index}${MATH_PLACEHOLDER_SUFFIX}`

    // A block of display math becomes a paragraph of its own, so that whatever
    // follows cannot absorb it: an immediately following `---` would otherwise
    // read as a setext underline and turn the formula into a heading.
    const isBlock = isDisplay && ownsItsLines(source, offset, match.length)
    if (!isBlock) return placeholder
    return `\n\n${placeholder}\n\n`
  })

  return { text: replaced, mathItems: mathItems }
}

function renderMath(item) {
  return katex.renderToString(item.body, {
    displayMode: item.display,
    throwOnError: false,
    strict: false,
  })
}

/**
 * Puts the math back. Display math that marked wrapped in its own paragraph is
 * unwrapped first, so the block-level KaTeX output is not nested inside a <p>.
 */
function restoreMath(html, mathItems) {
  const paragraphPattern = new RegExp(
    `<p>\\s*${MATH_PLACEHOLDER_PREFIX}(\\d+)${MATH_PLACEHOLDER_SUFFIX}\\s*</p>`,
    'g',
  )
  const inlinePattern = new RegExp(
    `${MATH_PLACEHOLDER_PREFIX}(\\d+)${MATH_PLACEHOLDER_SUFFIX}`,
    'g',
  )

  const unwrapped = html.replace(paragraphPattern, (match, index) => {
    const item = mathItems[Number(index)]
    if (!item.display) return match
    return renderMath(item)
  })

  return unwrapped.replace(inlinePattern, (match, index) => renderMath(mathItems[Number(index)]))
}

function renderMarkdown(source) {
  const body = stripFrontmatter(source)
  const extracted = extractInline(body)
  const html = marked.parse(extracted.text)
  return restoreMath(html, extracted.mathItems)
}

/** Keeps only the section a `#Heading` subpath points at. */
function sliceSubpath(markdown, subpath) {
  if (!subpath) return markdown
  if (!subpath.startsWith('#')) return markdown

  const heading = subpath.slice(1).trim()
  const lines = markdown.split('\n')
  const isTargetHeading = line => {
    const match = line.match(/^(#{1,6})\s+(.*)$/)
    if (!match) return false
    return match[2].trim() === heading
  }

  const startIndex = lines.findIndex(isTargetHeading)
  if (startIndex < 0) return markdown

  const startLevel = lines[startIndex].match(/^#+/)[0].length
  let endIndex = lines.length
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#{1,6})\s/)
    if (!match) continue
    if (match[1].length > startLevel) continue
    endIndex = i
    break
  }

  return lines.slice(startIndex, endIndex).join('\n')
}

// ------------------------------------------------------------------ geometry

function sideAnchor(node, side) {
  if (side === 'top') return { x: node.x + node.width / 2, y: node.y }
  if (side === 'bottom') return { x: node.x + node.width / 2, y: node.y + node.height }
  if (side === 'left') return { x: node.x, y: node.y + node.height / 2 }
  return { x: node.x + node.width, y: node.y + node.height / 2 }
}

/** JSON Canvas allows omitting a side; pick the one facing the other node. */
function inferSide(node, other, isSource) {
  const dx = other.x + other.width / 2 - (node.x + node.width / 2)
  const dy = other.y + other.height / 2 - (node.y + node.height / 2)
  const isHorizontal = Math.abs(dx) >= Math.abs(dy)

  if (isHorizontal) {
    const towardsRight = dx >= 0
    if (isSource) return towardsRight ? 'right' : 'left'
    return towardsRight ? 'left' : 'right'
  }

  const towardsBottom = dy >= 0
  if (isSource) return towardsBottom ? 'bottom' : 'top'
  return towardsBottom ? 'top' : 'bottom'
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

function vaultUrl(path) {
  return encodePath(config.vaultRoot + path)
}

function noteHref(path) {
  return `?note=${encodeURIComponent(path)}`
}

function rawHref(path) {
  return `?raw=${encodeURIComponent(path)}`
}

function fileExtension(path) {
  const dotIndex = path.lastIndexOf('.')
  if (dotIndex < 0) return ''
  return path.slice(dotIndex + 1).toLowerCase()
}

function baseName(path) {
  const slashIndex = path.lastIndexOf('/')
  const withExtension = slashIndex < 0 ? path : path.slice(slashIndex + 1)
  return withExtension.replace(/\.md$/i, '')
}

function markdownElement(html) {
  const el = document.createElement('div')
  el.className = 'markdown-preview'
  el.innerHTML = html
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
 * vault fails, and the one an HTTP status cannot describe.
 */
async function fetchFile(url) {
  try {
    return await fetch(url)
  } catch (cause) {
    const reason = 'the host is unreachable, or sends no CORS header for this page'
    throw new Error(`Cannot reach ${url} — ${reason}`, { cause: cause })
  }
}

async function loadMarkdownInto(contentEl, node) {
  const url = vaultUrl(node.file)
  const response = await fetchFile(url)
  if (!response.ok) throw new Error(`Cannot load ${node.file} (HTTP ${response.status})`)

  const source = await response.text()
  const section = sliceSubpath(source, node.subpath)
  contentEl.replaceChildren(markdownElement(renderMarkdown(section)))
}

function fillFileNode(contentEl, node) {
  const extension = fileExtension(node.file)

  if (IMAGE_EXTENSIONS.includes(extension)) {
    const image = document.createElement('img')
    image.className = 'canvas-node-image'
    image.src = vaultUrl(node.file)
    image.alt = node.file
    contentEl.dataset.fill = 'true'
    contentEl.replaceChildren(image)
    return
  }

  if (holdsEmbed(node)) {
    const frame = document.createElement('iframe')
    frame.className = 'canvas-node-embed'
    frame.src = vaultUrl(node.file)
    contentEl.dataset.fill = 'true'
    contentEl.replaceChildren(frame)
    return
  }

  contentEl.replaceChildren(placeholderElement('Loading…'))
  loadMarkdownInto(contentEl, node).catch(error => {
    contentEl.replaceChildren(placeholderElement(error.message))
  })
}

function fillLinkNode(contentEl, node) {
  const frame = document.createElement('iframe')
  frame.className = 'canvas-node-embed'
  frame.src = node.url
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
 * Two destinations per card: the title text reads the note, the icon beside it
 * shows the markdown source. Both go through this page's own views rather than
 * straight at the `.md`, so the text stays correct whatever media type the host
 * serves markdown as.
 */
function createTitleElement(node) {
  const titleEl = document.createElement('div')
  titleEl.className = 'canvas-node-title'

  // Each anchor is inline-sized, so only its own text and icon are clickable —
  // not the empty remainder of the title row.
  const isLink = node.type === 'link'
  const primaryHref = isLink ? node.url : noteHref(config.vaultRoot + node.file)
  const primaryTooltip = isLink ? `Open ${node.url}` : `Read ${node.file}`
  const primaryEl = createTitleLink(primaryHref, primaryTooltip)

  const textEl = document.createElement('span')
  textEl.className = 'canvas-node-title-text'
  textEl.textContent = nodeTitleText(node)
  primaryEl.append(textEl, createIcon(EXTERNAL_LINK_ICON))
  titleEl.appendChild(primaryEl)

  if (isLink) return titleEl

  const sourceEl = createTitleLink(rawHref(config.vaultRoot + node.file), `View source of ${node.file}`)
  sourceEl.classList.add('canvas-node-source-link')
  sourceEl.appendChild(createIcon(SOURCE_ICON))
  titleEl.appendChild(sourceEl)
  return titleEl
}

/** A line that opens a block: either a heading already, or a construct the next lines continue. */
const BLOCK_OPENER = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\||---)/

/** `===` or `---` under a line of prose, which makes that line a heading. */
const SETEXT_UNDERLINE = /^(=+|-+)\s*$/

/**
 * Text nodes are commonly written title first, so the first line becomes the
 * card's header — but only when it is a paragraph in its own right. A line that
 * opens a list, a quote, a fence or a heading belongs to what follows it, and
 * lifting it out would leave both halves wrong.
 */
function splitTextNode(text) {
  const source = text || ''
  const lines = source.split('\n')
  const firstLine = lines[0].trim()
  const body = lines.slice(1).join('\n')

  const wholeCardWouldBeHeader = body.trim() === ''
  if (firstLine === '' || wholeCardWouldBeHeader) return { header: null, body: source }
  if (BLOCK_OPENER.test(firstLine)) return { header: null, body: source }
  if (SETEXT_UNDERLINE.test(lines[1].trim())) return { header: null, body: source }

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
  headerEl.appendChild(markdownElement(renderMarkdown(line)))
  return headerEl
}

/** Group frames carry their name above the frame; nothing sits inside them. */
function createGroupLabelElement(node) {
  const labelEl = document.createElement('div')
  labelEl.className = 'canvas-node-label'
  labelEl.textContent = node.label
  return labelEl
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
    return el
  }

  if (node.type === 'file' || node.type === 'link') el.appendChild(createTitleElement(node))

  const text = node.type === 'text' ? splitTextNode(node.text) : null
  if (text !== null && text.header !== null) el.appendChild(createTextHeaderElement(text.header))

  const contentEl = document.createElement('div')
  contentEl.className = 'canvas-node-content'
  el.appendChild(contentEl)

  if (node.type === 'text') {
    contentEl.replaceChildren(markdownElement(renderMarkdown(text.body)))
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
  const fromSide = edge.fromSide || inferSide(fromNode, toNode, true)
  const toSide = edge.toSide || inferSide(toNode, fromNode, false)
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

  const spacing = GRID_SIZE * view.zoom
  backgroundEl.style.backgroundSize = `${spacing}px ${spacing}px`
  backgroundEl.style.backgroundPosition = `${view.x % spacing}px ${view.y % spacing}px`

  const zoomLabel = `${Math.round(view.zoom * 100)}%`
  if (zoomLabel === shownZoomLabel) return
  shownZoomLabel = zoomLabel
  zoomResetEl.textContent = zoomLabel
}

function zoomAt(screenX, screenY, nextZoom) {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
  const canvasX = (screenX - view.x) / view.zoom
  const canvasY = (screenY - view.y) / view.zoom

  view.zoom = clamped
  view.x = screenX - canvasX * clamped
  view.y = screenY - canvasY * clamped
  applyView()
}

function zoomAroundCentre(factor) {
  const rect = wrapperEl.getBoundingClientRect()
  zoomAt(rect.width / 2, rect.height / 2, view.zoom * factor)
}

function fitToContent(bounds) {
  const rect = wrapperEl.getBoundingClientRect()
  const contentWidth = bounds.maxX - bounds.minX
  const contentHeight = bounds.maxY - bounds.minY

  const availableWidth = rect.width - FIT_PADDING * 2
  const availableHeight = rect.height - FIT_PADDING * 2
  const scaleX = availableWidth / Math.max(contentWidth, 1)
  const scaleY = availableHeight / Math.max(contentHeight, 1)
  const scale = Math.min(scaleX, scaleY, FIT_MAX_ZOOM)

  view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
  view.x = rect.width / 2 - (bounds.minX + contentWidth / 2) * view.zoom
  view.y = rect.height / 2 - (bounds.minY + contentHeight / 2) * view.zoom
  applyView()
  fittedView = { x: view.x, y: view.y, zoom: view.zoom }
}

/** True while the view is still the one that was fitted, untouched since. */
function viewIsAsFitted() {
  if (fittedView === null) return false

  const samePan = view.x === fittedView.x && view.y === fittedView.y
  return samePan && view.zoom === fittedView.zoom
}

/** Node content scrolls and selects text on its own; everything else pans. */
function isInsideNodeContent(target) {
  return target instanceof Element && target.closest('.canvas-node-content') !== null
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

  wrapperEl.addEventListener(
    'wheel',
    event => {
      // A trackpad pinch arrives as a wheel event with ctrlKey set.
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const factor = Math.exp(-event.deltaY / ZOOM_WHEEL_SENSITIVITY)
        zoomAt(event.clientX, event.clientY, view.zoom * factor)
        return
      }

      if (isInsideNodeContent(event.target)) return

      event.preventDefault()
      view.x -= event.deltaX
      view.y -= event.deltaY
      applyView()
    },
    { passive: false },
  )

  zoomInEl.addEventListener('click', () => zoomAroundCentre(ZOOM_STEP))
  zoomOutEl.addEventListener('click', () => zoomAroundCentre(1 / ZOOM_STEP))
  zoomResetEl.addEventListener('click', () => zoomAroundCentre(1 / view.zoom))
  // Recomputed at click time: a drag leaves the bounds captured at load stale.
  zoomFitEl.addEventListener('click', () => fitToContent(contentBounds(layout.nodes)))
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
    for (const item of dragged) placeNode(item.node, item.startX + dx, item.startY + dy)

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

  if (keepsAuthoredSize) {
    node.width = authored.width
    node.height = authored.height
    el.style.width = `${authored.width}px`
    el.style.height = `${authored.height}px`
    el.style.maxHeight = ''
    delete el.dataset.sized
    return
  }

  node.width = size.width
  el.style.width = `${size.width}px`

  if (holdsEmbed(node)) {
    node.height = size.maxHeight
    el.style.height = `${size.maxHeight}px`
    el.style.maxHeight = ''
    delete el.dataset.sized
    return
  }

  el.style.height = 'auto'
  el.style.maxHeight = `${size.maxHeight}px`
  el.dataset.sized = 'content'
}

/**
 * One read pass, after every card has been written: the browser lays out once,
 * and the height each card settled on goes back into the node data, which the
 * edges, the edge layer and the fit are all computed from.
 */
function readCardHeights() {
  for (const node of layout.nodes) {
    node.height = layout.elements.get(node.id).offsetHeight
  }
}

/**
 * A content-sized card knows its height only once the browser has laid it out,
 * and again whenever a note, an image or a formula lands. The node data follows
 * the element, and everything computed from the box is redone — including the
 * fit, for as long as the view is still the one this page fitted.
 */
function observeCardHeight(el, node) {
  const observer = new ResizeObserver(() => {
    const height = el.offsetHeight
    if (height === node.height) return

    node.height = height
    relayoutNodeEdges(node)

    const bounds = contentBounds(layout.nodes)
    resizeEdgeLayer(bounds)
    if (viewIsAsFitted()) fitToContent(bounds)
  })
  observer.observe(el)
}

/** Re-draws every card at the named size, then re-routes the edges and refits. */
function applyCardSize(sizeName) {
  config.cardSize = sizeName
  localStorage.setItem(CARD_SIZE_STORAGE_KEY, sizeName)
  cardSizeEl.textContent = CARD_SIZES[sizeName].label

  for (const node of layout.nodes) applyNodeSize(layout.elements.get(node.id), node)
  readCardHeights()
  // Both endpoints have to hold their new box before an edge between them is routed.
  for (const node of layout.nodes) relayoutNodeEdges(node)

  const bounds = contentBounds(layout.nodes)
  resizeEdgeLayer(bounds)
  fitToContent(bounds)
}

/** The `cards` parameter names a size for one page load; the control persists a choice. */
function preferredCardSize(params) {
  const requested = params.get('cards')
  if (requested !== null) {
    if (requested in CARD_SIZES) return requested
    const names = CARD_SIZE_NAMES.join(', ')
    throw new Error(`the cards parameter accepts ${names}, got ${requested}`)
  }

  const stored = localStorage.getItem(CARD_SIZE_STORAGE_KEY)
  if (stored !== null && stored in CARD_SIZES) return stored
  return 'actual'
}

function installCardSizeControl() {
  cardSizeEl.textContent = CARD_SIZES[config.cardSize].label
  cardSizeEl.addEventListener('click', () => {
    const current = CARD_SIZE_NAMES.indexOf(config.cardSize)
    const next = CARD_SIZE_NAMES[(current + 1) % CARD_SIZE_NAMES.length]
    applyCardSize(next)
  })
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

function drawCanvas(data) {
  if (!Array.isArray(data.nodes)) throw new TypeError('canvas file has no "nodes" array')

  const nodes = data.nodes
  const edges = Array.isArray(data.edges) ? data.edges : []
  const nodesById = new Map(nodes.map(node => [node.id, node]))
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
    observeCardHeight(el, node)
    canvasEl.appendChild(el)
  }

  readCardHeights()
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
function assertAllowedHost(path, parameterName) {
  const url = new URL(path, window.location.href)

  const isSameProtocol = url.protocol === window.location.protocol
  const isSameHost = url.host === window.location.host
  if (isSameProtocol && isSameHost) return

  const isHttps = url.protocol === 'https:'
  const isAllowedHost = REMOTE_HOSTS.includes(url.hostname)
  if (isHttps && isAllowedHost) return

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
 */
function resolveVaultRoot(params, canvasPath) {
  const explicitRoot = params.get('vault')
  if (explicitRoot === null) return directoryOf(canvasPath)

  assertAllowedHost(explicitRoot, 'vault')
  if (explicitRoot === '') return ''
  if (explicitRoot.endsWith('/')) return explicitRoot
  return `${explicitRoot}/`
}

/**
 * Shows one note on its own, either rendered for reading (`note`) or as its
 * markdown source (`raw`), with a link across to the other one.
 *
 * The bytes are read here rather than by linking straight at the `.md`, because
 * hosts disagree on the media type they give markdown — GitHub Pages, nginx and
 * Python's `http.server` all send it without a charset, and the browser then
 * decodes UTF-8 as Latin-1. `Response.text()` always decodes as UTF-8, whatever
 * the response header claims.
 */
async function showFileView(path, mode) {
  assertAllowedHost(path, mode)
  const isRaw = mode === 'raw'

  document.body.dataset.mode = 'file'
  document.title = path
  fileViewPathEl.textContent = path
  fileViewToggleEl.href = isRaw ? noteHref(path) : rawHref(path)
  fileViewToggleEl.textContent = isRaw ? 'Rendered' : 'Source'
  fileViewEl.hidden = false

  const response = await fetchFile(encodePath(path))
  if (!response.ok) throw new Error(`Cannot read ${path} (HTTP ${response.status})`)
  const text = await response.text()

  if (!isRaw) {
    fileViewBodyEl.replaceChildren(markdownElement(renderMarkdown(text)))
    return
  }

  const sourceEl = document.createElement('pre')
  sourceEl.className = 'file-view-source'
  sourceEl.textContent = text
  fileViewBodyEl.replaceChildren(sourceEl)
}

async function main() {
  installThemeToggles()
  marked.use({ gfm: true, breaks: false })

  const params = new URLSearchParams(window.location.search)

  for (const mode of ['note', 'raw']) {
    const path = params.get(mode)
    if (path === null) continue
    await showFileView(path, mode)
    return
  }

  const canvasPath = params.get('canvas') || DEFAULT_CANVAS_PATH
  assertAllowedHost(canvasPath, 'canvas')
  config.vaultRoot = resolveVaultRoot(params, canvasPath)
  config.cardSize = preferredCardSize(params)

  showStatus(`Loading ${canvasPath} …`)
  const response = await fetchFile(encodePath(canvasPath))
  if (!response.ok) throw new Error(`Cannot read ${canvasPath} (HTTP ${response.status})`)

  const data = await response.json()
  statusEl.hidden = true

  drawCanvas(data)
  fitToContent(contentBounds(layout.nodes))
  installViewportControls()
  installCardSizeControl()
}

main().catch(error => {
  showStatus(String(error.message || error))
  throw error
})
