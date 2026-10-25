/**
 * What a board draws in a card: its colour, its title, the header a text card
 * lifts from its first line, a group's label and background, and what the card
 * holds — its text, a note, an image, or a framed file or web page.
 */

import { fetchFile, fileExtension, baseName, webUrl } from './resources.js'
import { createIcon, placeholderElement } from './elements.js'

/**
 * A link card frames a page from any host. The page runs as it would in a tab
 * of its own, but cannot navigate this page or open dialogs over it. A page on
 * this page's own origin could lift the sandbox, but such a page comes from
 * this site. File cards get no sandbox: Chrome refuses to show a PDF in a
 * sandboxed frame.
 */
const LINK_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'

/** Obsidian's six preset canvas colors, keyed by the string used in the file. */
const PRESET_COLORS = {
  '1': '#fb464c',
  '2': '#e9973f',
  '3': '#e0de71',
  '4': '#44cf6e',
  '5': '#53dfdd',
  '6': '#a882ff',
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif']

export function resolveColor(value) {
  if (!value) return null
  if (PRESET_COLORS[value]) return PRESET_COLORS[value]
  if (value.startsWith('#')) return value
  return null
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

/** Obsidian heads a file or link card with the file name, inside the card. */
export function nodeTitleText(node) {
  if (node.type === 'file') return baseName(node.file)
  return node.url
}

/** lucide `external-link`: the title opens a separate tab. */
const EXTERNAL_LINK_ICON =
  '<path d="M15 3h6v6"/><path d="M10 14 21 3"/>' +
  '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/>'

/** lucide `code`: the familiar mark for "show me the source". */
const SOURCE_ICON = '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'

function createTitleLink(href, tooltip) {
  const linkEl = document.createElement('a')
  linkEl.className = 'canvas-node-title-link'
  linkEl.href = href
  linkEl.target = '_blank'
  linkEl.rel = 'noopener'
  linkEl.title = tooltip
  return linkEl
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
 * A link, and a file the browser can only frame, are drawn in an iframe, which
 * has no height of its own: such a card cannot be sized by its content, and is
 * given the cap as its height instead.
 */
export function holdsEmbed(node) {
  if (node.type === 'link') return true
  if (node.type !== 'file') return false

  const extension = fileExtension(node.file)
  if (extension === 'md') return false
  return !IMAGE_EXTENSIONS.includes(extension)
}

/**
 * One board's cards. `config` holds where the vault and the canvas are;
 * `remoteHosts` are the hosts a refused file is told to load from; `resources`
 * and `markdown` are the board's own; `actions` show a note inside the board.
 */
export function createCardRenderer(config, remoteHosts, resources, markdown, actions) {
  const { vaultUrl, noteHref, rawHref } = resources
  const { renderMarkdown, sliceSubpath, markdownElement, splitTextNode } = markdown
  const { showOnPlainClick, openFile } = actions

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
      const hosts = remoteHosts.join(', ')
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

  /**
   * A group's background image fills its frame as its backgroundStyle names:
   * `cover` crops the image to fill the frame, `ratio` shows the whole image at
   * its own proportions, and `repeat` tiles it at its own size.
   */
  function applyGroupBackground(el, node) {
    const url = vaultUrl(node.background)
    if (url === null) {
      const hosts = remoteHosts.join(', ')
      const path = config.vaultRoot + node.background
      console.warn(`group ${node.id}: a background loads from a same-origin path or an https URL on ${hosts}, not ${path}`)
      return
    }

    // vaultUrl percent-encodes every path segment, so no quote in it ends the CSS string.
    el.style.backgroundImage = `url("${url}")`
    const isKnownStyle = BACKGROUND_STYLES.includes(node.backgroundStyle)
    el.dataset.backgroundStyle = isKnownStyle ? node.backgroundStyle : 'cover'
  }

  /**
   * Draws into an element what the board draws in a card: the card's colour, its
   * title, and the box that `fillNodeContent` draws what it holds into.
   */
  function fillNodeElement(el, node) {
    const color = resolveColor(node.color)
    if (color) {
      el.style.setProperty('--node-color', color)
      el.dataset.colored = 'true'
    }

    if (node.type === 'group') {
      if (node.label) el.appendChild(createGroupLabelElement(node))
      if (node.background) applyGroupBackground(el, node)
      return
    }

    if (node.type === 'file' || node.type === 'link') el.appendChild(createTitleElement(node))

    const text = node.type === 'text' ? splitTextNode(node.text) : null
    if (text !== null && text.header !== null) el.appendChild(createTextHeaderElement(text.header))

    const contentEl = document.createElement('div')
    contentEl.className = 'canvas-node-content'
    el.appendChild(contentEl)
  }

  /** Draws what a card holds into its box: its text, its file or its web page. A group holds nothing. */
  function fillNodeContent(el, node) {
    if (node.type === 'group') return

    const contentEl = el.querySelector(':scope > .canvas-node-content')
    if (node.type === 'text') {
      const text = splitTextNode(node.text)
      contentEl.replaceChildren(markdownElement(renderMarkdown(text.body), config.canvasPath))
    } else if (node.type === 'file') {
      fillFileNode(contentEl, node)
    } else if (node.type === 'link') {
      fillLinkNode(contentEl, node)
    } else {
      contentEl.replaceChildren(placeholderElement(`Unsupported node type: ${node.type}`))
    }
  }

  return { fillFileNode, fillNodeElement, fillNodeContent }
}
