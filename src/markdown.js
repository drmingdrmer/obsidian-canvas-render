/**
 * Markdown as a board draws it: marked with math and wikilinks, sanitized by
 * DOMPurify, and with each link and image resolved against the document it is
 * written in.
 */

import { encodePath, fileExtension, directoryOf } from './resources.js'

/**
 * marked passes raw HTML through untouched, so rendered markdown goes through
 * DOMPurify. KaTeX writes every formula in MathML as well as in HTML, and
 * `semantics` and `annotation` are the two of its elements DOMPurify drops by
 * default.
 */
const SANITIZE_OPTIONS = { ADD_TAGS: ['semantics', 'annotation'], RETURN_DOM_FRAGMENT: true }

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

/**
 * One board's markdown. `resources` gives the links that wikilinks and images
 * take, and `actions` are what the board does when a wikilink is followed.
 * The libraries load after the board is built, so `startMarkdown` takes them.
 */
export function createMarkdown(resources, actions) {
  const { noteHref, imageUrls } = resources
  const { linkedCard, showCardPreview, closeCardPreview, closeFileView, flyToCard, showOnPlainClick, openFile } = actions

  /** The board's own marked, made by `startMarkdown`, so that a page's own `marked` keeps its options. */
  let markdownParser = null

  /** KaTeX and DOMPurify, as `startMarkdown` takes them. */
  let katex = null
  let DOMPurify = null

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

  /** Takes marked, KaTeX and DOMPurify once they have loaded, and makes the board's own marked. */
  function startMarkdown(libraries) {
    katex = libraries.katex
    DOMPurify = libraries.DOMPurify
    // A single newline is a line break, as in Obsidian with "Strict line breaks" off.
    markdownParser = new libraries.marked.Marked({ gfm: true, breaks: true, extensions: MARKDOWN_EXTENSIONS })
  }

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
   * A wikilink to a note that has a card on the board shows that card in the
   * preview, and with Alt held flies the view to the card. Any other opens the
   * note on its own, looked for beside the document the link is written in, as
   * Obsidian looks first; a click with ⌘, Ctrl or Shift opens the link as the
   * browser would. A link to a heading of its own document leads nowhere.
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
      if (!event.altKey) {
        showCardPreview(node, link)
        return
      }
      closeCardPreview()
      closeFileView()
      flyToCard(node)
    })
    // After the listener above, so that a card on the board wins.
    showOnPlainClick(link, () => openFile(path, 'note'))
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

  return { startMarkdown, renderMarkdown, sliceSubpath, markdownElement, splitTextNode }
}
