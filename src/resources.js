/**
 * Where a board's files are, and which hosts it reads them from: paths and
 * URLs, links into the note views, and the request that fetches a file.
 */

/** The scheme and host at the head of an absolute URL; everything after is path. */
const ABSOLUTE_URL_HEAD = /^https?:\/\/[^/]*/i

/**
 * Percent-encodes each segment but keeps the separators, and keeps an absolute
 * URL's scheme and host. Encoding the whole string in one go would escape the
 * slashes; leaving it alone would let a `#` in a file name cut the URL short.
 */
export function encodePath(path) {
  const head = path.match(ABSOLUTE_URL_HEAD)
  const prefix = head === null ? '' : head[0]
  const segments = path.slice(prefix.length).split('/')
  return prefix + segments.map(encodeURIComponent).join('/')
}

export function fileExtension(path) {
  const dotIndex = path.lastIndexOf('.')
  const slashIndex = path.lastIndexOf('/')
  const dotInName = dotIndex > slashIndex
  if (!dotInName) return ''
  return path.slice(dotIndex + 1).toLowerCase()
}

export function baseName(path) {
  const slashIndex = path.lastIndexOf('/')
  const withExtension = slashIndex < 0 ? path : path.slice(slashIndex + 1)
  return withExtension.replace(/\.md$/i, '')
}

/**
 * A host that sends no `Access-Control-Allow-Origin` makes `fetch` reject with
 * a bare `TypeError` before any status code exists — the likeliest way a remote
 * vault fails, and the one an HTTP status cannot describe. A response with an
 * HTTP error status throws too, naming the file as `name`.
 */
export async function fetchFile(url, name) {
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

/**
 * The URL a link card frames and links to, or null for anything but a web
 * page: the frame and the title would run a `javascript:` URL in this page.
 */
export function webUrl(url) {
  const parsed = URL.parse(url, window.location.href)
  if (parsed === null) return null

  const isWebPage = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  if (!isWebPage) return null
  return parsed.href
}

export function directoryOf(path) {
  const slashIndex = path.lastIndexOf('/')
  if (slashIndex < 0) return ''
  return path.slice(0, slashIndex + 1)
}

/**
 * The paths and links of one board's files. `config` holds where its vault is,
 * and whether the board owns the page; `appUrl` is the folder of the renderer's
 * own page; `remoteHosts` are the hosts besides this page's own that the board
 * reads from.
 */
export function createResources(config, appUrl, remoteHosts) {
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
    return config.ownsPage ? '' : appUrl.href
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
   * Content may come from this page's own origin, or over https from a host in
   * `remoteHosts`. Any other host, and any other scheme — `data:`, `javascript:`
   * — is either a configuration mistake or an attempt to run foreign script here.
   */
  function isAllowedSource(path) {
    const url = URL.parse(path, window.location.href)
    if (url === null) return false

    const isSameProtocol = url.protocol === window.location.protocol
    const isSameHost = url.host === window.location.host
    if (isSameProtocol && isSameHost) return true

    const isHttps = url.protocol === 'https:'
    const isAllowedHost = remoteHosts.includes(url.hostname)
    return isHttps && isAllowedHost
  }

  function assertAllowedHost(path, parameterName) {
    if (isAllowedSource(path)) return

    const hosts = remoteHosts.join(', ')
    throw new Error(
      `the ${parameterName} parameter accepts a same-origin path or an https URL on ${hosts}, got ${path}`,
    )
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

  return { vaultUrl, noteHref, rawHref, imageUrls, assertAllowedHost, resolveVaultRoot, resolveAttachments }
}
