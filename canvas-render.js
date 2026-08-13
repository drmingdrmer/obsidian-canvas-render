'use strict'

/**
 * Renders a JSON Canvas file (https://jsoncanvas.org) the way Obsidian draws it:
 * nodes are absolutely positioned DOM elements, edges are one SVG layer beneath
 * them, and the whole thing sits in a pan/zoom viewport over a dot grid.
 */

// ---------------------------------------------------------------- constants

const DEFAULT_CANVAS_PATH = 'vault/demo.canvas'
const THEME_STORAGE_KEY = 'canvas-render-theme'

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
const themeToggleEl = document.getElementById('theme-toggle')

// --------------------------------------------------------------------- state

/** Screen position of canvas origin, plus the current scale factor. */
const view = { x: 0, y: 0, zoom: 1 }

/** Read from the URL query once at startup, then fixed for the life of the page. */
const config = { vaultRoot: '' }

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
  themeToggleEl.textContent = theme === 'dark' ? '☀' : '☾'
  localStorage.setItem(THEME_STORAGE_KEY, theme)
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

/** Pulls math out of the source so marked cannot mangle `_`, `*` and `\` inside it. */
function extractInline(source) {
  const mathItems = []

  const replaced = source.replace(INLINE_SCAN, (match, code, display, inline, wikilink) => {
    if (code !== undefined) return code

    if (wikilink !== undefined) return wikilinkToHtml(wikilink)

    const isDisplay = display !== undefined
    const body = isDisplay ? display : inline
    mathItems.push({ body: body, display: isDisplay })
    const index = mathItems.length - 1
    return `${MATH_PLACEHOLDER_PREFIX}${index}${MATH_PLACEHOLDER_SUFFIX}`
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

function vaultUrl(path) {
  const segments = path.split('/').map(encodeURIComponent)
  return config.vaultRoot + segments.join('/')
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

async function loadMarkdownInto(contentEl, node) {
  const url = vaultUrl(node.file)
  const response = await fetch(url)

  if (!response.ok) {
    contentEl.replaceChildren(placeholderElement(`无法加载 ${node.file}（HTTP ${response.status}）`))
    return
  }

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

  if (extension !== 'md') {
    const frame = document.createElement('iframe')
    frame.className = 'canvas-node-embed'
    frame.src = vaultUrl(node.file)
    contentEl.dataset.fill = 'true'
    contentEl.replaceChildren(frame)
    return
  }

  contentEl.replaceChildren(placeholderElement('加载中…'))
  loadMarkdownInto(contentEl, node)
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

/** Where that title takes the reader when clicked. */
function nodeTitleHref(node) {
  if (node.type === 'file') return vaultUrl(node.file)
  return node.url
}

/** lucide `external-link`, signalling that the title opens a separate tab. */
function createExternalLinkIcon() {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
  icon.setAttribute('class', 'canvas-node-title-icon')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '2')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  icon.innerHTML =
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/>' +
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>'
  return icon
}

function createTitleElement(node) {
  const titleEl = document.createElement('div')
  titleEl.className = 'canvas-node-title'

  // The anchor is inline-sized, so only the text and the icon are clickable —
  // not the empty remainder of the title row.
  const linkEl = document.createElement('a')
  linkEl.className = 'canvas-node-title-link'
  linkEl.href = nodeTitleHref(node)
  linkEl.target = '_blank'
  linkEl.rel = 'noopener'
  linkEl.title = node.type === 'file' ? `打开 ${node.file}` : `打开 ${node.url}`

  const textEl = document.createElement('span')
  textEl.className = 'canvas-node-title-text'
  textEl.textContent = nodeTitleText(node)

  linkEl.append(textEl, createExternalLinkIcon())
  titleEl.appendChild(linkEl)
  return titleEl
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
  el.style.width = `${node.width}px`
  el.style.height = `${node.height}px`

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

  const contentEl = document.createElement('div')
  contentEl.className = 'canvas-node-content'
  el.appendChild(contentEl)

  if (node.type === 'text') {
    contentEl.replaceChildren(markdownElement(renderMarkdown(node.text || '')))
  } else if (node.type === 'file') {
    fillFileNode(contentEl, node)
  } else if (node.type === 'link') {
    fillLinkNode(contentEl, node)
  } else {
    contentEl.replaceChildren(placeholderElement(`不支持的节点类型：${node.type}`))
  }

  return el
}

// -------------------------------------------------------------- edge element

function createEdgeElements(edge, fromNode, toNode) {
  const fromSide = edge.fromSide || inferSide(fromNode, toNode, true)
  const toSide = edge.toSide || inferSide(toNode, fromNode, false)
  const geometry = edgeGeometry(fromNode, fromSide, toNode, toSide)

  const group = document.createElementNS(SVG_NAMESPACE, 'g')
  const color = resolveColor(edge.color)
  if (color) group.style.setProperty('--edge-color', color)

  const path = document.createElementNS(SVG_NAMESPACE, 'path')
  const { start, startControl, endControl, end } = geometry
  path.setAttribute(
    'd',
    `M ${start.x} ${start.y} C ${startControl.x} ${startControl.y}, ${endControl.x} ${endControl.y}, ${end.x} ${end.y}`,
  )
  path.setAttribute('class', 'canvas-edge-line')
  group.appendChild(path)

  // Spec default: no arrow at the source, an arrow at the target.
  if (edge.fromEnd === 'arrow') {
    const arrow = document.createElementNS(SVG_NAMESPACE, 'polygon')
    arrow.setAttribute('points', arrowPoints(geometry.start, geometry.startNormal))
    arrow.setAttribute('class', 'canvas-edge-arrow')
    group.appendChild(arrow)
  }

  if (edge.toEnd !== 'none') {
    const arrow = document.createElementNS(SVG_NAMESPACE, 'polygon')
    arrow.setAttribute('points', arrowPoints(geometry.end, geometry.endNormal))
    arrow.setAttribute('class', 'canvas-edge-arrow')
    group.appendChild(arrow)
  }

  if (edge.label) {
    const midpoint = bezierMidpoint(geometry)
    const text = document.createElementNS(SVG_NAMESPACE, 'text')
    text.setAttribute('x', midpoint.x)
    text.setAttribute('y', midpoint.y)
    text.setAttribute('class', 'canvas-edge-label')
    text.textContent = edge.label
    group.appendChild(text)
  }

  return group
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
}

/** Node content scrolls and selects text on its own; everything else pans. */
function isInsideNodeContent(target) {
  return target instanceof Element && target.closest('.canvas-node-content') !== null
}

/** Card titles are links, so a press on one must not be swallowed by a pan. */
function startsPan(target) {
  if (!(target instanceof Element)) return true
  return target.closest('.canvas-node-content, .canvas-node-title-link') === null
}

function installViewportControls(bounds) {
  let panPointerId = null
  let panOriginX = 0
  let panOriginY = 0

  wrapperEl.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.button !== 1) return
    if (event.button === 0 && !startsPan(event.target)) return

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
  zoomFitEl.addEventListener('click', () => fitToContent(bounds))
  themeToggleEl.addEventListener('click', () => {
    const isDark = document.documentElement.dataset.theme === 'dark'
    applyTheme(isDark ? 'light' : 'dark')
  })
}

// ------------------------------------------------------------------- drawing

function drawCanvas(data) {
  if (!Array.isArray(data.nodes)) throw new TypeError('canvas 文件缺少 "nodes" 数组')

  const nodes = data.nodes
  const edges = Array.isArray(data.edges) ? data.edges : []
  const nodesById = new Map(nodes.map(node => [node.id, node]))

  // Groups first so they sit behind; within each class the file order is the z-order.
  const groups = nodes.filter(node => node.type === 'group')
  const others = nodes.filter(node => node.type !== 'group')
  for (const node of groups.concat(others)) {
    canvasEl.appendChild(createNodeElement(node))
  }

  const bounds = contentBounds(nodes)
  const layerX = bounds.minX - EDGE_LAYER_MARGIN
  const layerY = bounds.minY - EDGE_LAYER_MARGIN
  const layerWidth = bounds.maxX - bounds.minX + EDGE_LAYER_MARGIN * 2
  const layerHeight = bounds.maxY - bounds.minY + EDGE_LAYER_MARGIN * 2

  edgesEl.style.left = `${layerX}px`
  edgesEl.style.top = `${layerY}px`
  edgesEl.setAttribute('width', layerWidth)
  edgesEl.setAttribute('height', layerHeight)
  edgesEl.setAttribute('viewBox', `${layerX} ${layerY} ${layerWidth} ${layerHeight}`)

  for (const edge of edges) {
    const fromNode = nodesById.get(edge.fromNode)
    const toNode = nodesById.get(edge.toNode)
    if (!fromNode || !toNode) {
      console.warn(`edge ${edge.id} references a missing node`, edge)
      continue
    }
    edgesEl.appendChild(createEdgeElements(edge, fromNode, toNode))
  }

  return bounds
}

// ----------------------------------------------------------------- bootstrap

function showStatus(message) {
  statusEl.textContent = message
  statusEl.hidden = false
}

/** The app only ever fetches from its own origin; a full URL is a configuration mistake. */
function assertRelativePath(path, parameterName) {
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(path)
  const isProtocolRelative = path.startsWith('//')
  if (!hasScheme && !isProtocolRelative) return
  throw new Error(`${parameterName} 参数只接受同源相对路径，收到的是 ${path}`)
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

  assertRelativePath(explicitRoot, 'vault')
  if (explicitRoot === '') return ''
  if (explicitRoot.endsWith('/')) return explicitRoot
  return `${explicitRoot}/`
}

async function main() {
  applyTheme(preferredTheme())
  marked.use({ gfm: true, breaks: false })

  const params = new URLSearchParams(window.location.search)
  const canvasPath = params.get('canvas') || DEFAULT_CANVAS_PATH
  assertRelativePath(canvasPath, 'canvas')
  config.vaultRoot = resolveVaultRoot(params, canvasPath)

  showStatus(`加载 ${canvasPath} …`)
  const response = await fetch(canvasPath)
  if (!response.ok) throw new Error(`无法读取 ${canvasPath}（HTTP ${response.status}）`)

  const data = await response.json()
  statusEl.hidden = true

  const bounds = drawCanvas(data)
  fitToContent(bounds)
  installViewportControls(bounds)
}

main().catch(error => {
  showStatus(String(error.message || error))
  throw error
})
