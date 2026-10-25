/**
 * The canvas a board draws: the nodes and edges its file holds, checked before
 * anything is drawn, and the questions the board asks of them.
 */

import { SIDE_NORMALS, inferSide } from './geometry.js'
import { nodeTitleText } from './cards.js'

function isJsonObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Throws when an optional field holds anything but a string, naming its owner
 * and the field. A field set to null is drawn as one left out.
 */
function validateOptionalString(name, record, field) {
  const value = record[field]
  if (value === undefined || value === null) return
  if (typeof value !== 'string') throw new TypeError(`${name} needs a string in "${field}"`)
}

/** The string field each node type draws from, as JSON Canvas names it. */
const CONTENT_FIELDS = new Map([['text', 'text'], ['file', 'file'], ['link', 'url']])

/**
 * Throws when a node lacks a field that drawing reads, or holds one of the
 * wrong type, naming the node and the field.
 */
function validateNode(node, index) {
  if (!isJsonObject(node)) throw new TypeError(`node ${index} is not a JSON object`)
  if (typeof node.id !== 'string') throw new TypeError(`node ${index} needs a string in "id"`)

  const name = `node "${node.id}"`
  if (typeof node.type !== 'string') throw new TypeError(`${name} needs a string in "type"`)
  for (const field of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(node[field])) throw new TypeError(`${name} needs a number in "${field}"`)
  }
  validateOptionalString(name, node, 'color')
  if (node.type === 'file') validateOptionalString(name, node, 'subpath')
  if (node.type === 'group') {
    validateOptionalString(name, node, 'label')
    validateOptionalString(name, node, 'background')
  }

  const contentField = CONTENT_FIELDS.get(node.type)
  if (contentField === undefined) return
  if (typeof node[contentField] !== 'string') throw new TypeError(`${name} needs a string in "${contentField}"`)
}

/**
 * Throws when an edge holds a field that drawing cannot read, naming the edge
 * and the field. An edge to a card the board lacks is no error: loadCanvas
 * leaves it out.
 */
function validateEdge(edge, index) {
  if (!isJsonObject(edge)) throw new TypeError(`edge ${index} is not a JSON object`)

  const name = typeof edge.id === 'string' ? `edge "${edge.id}"` : `edge ${index}`
  for (const field of ['fromSide', 'toSide']) {
    const side = edge[field]
    if (side === undefined || side === null) continue
    const isSide = Object.keys(SIDE_NORMALS).includes(side)
    if (!isSide) throw new TypeError(`${name} needs top, right, bottom or left in "${field}"`)
  }
  validateOptionalString(name, edge, 'color')
  validateOptionalString(name, edge, 'label')
}

/** Lists the edge under both its endpoints in `edgesByNode`, so a node finds the edges at it. */
export function indexEdge(edgesByNode, record) {
  for (const node of [record.fromNode, record.toNode]) {
    const attached = edgesByNode.get(node.id)
    if (attached) attached.push(record)
    else edgesByNode.set(node.id, [record])
  }
}

/** The sides an edge leaves and enters its cards by, where the board draws it. */
export function edgeSides(record) {
  const { edge, fromNode, toNode } = record
  const fromSide = edge.fromSide || inferSide(fromNode, toNode)
  const toSide = edge.toSide || inferSide(toNode, fromNode)
  return { fromSide, toSide }
}

/**
 * A dependency edge leaves a card by its right side, and enters by its left
 * side a card that builds on the first. An edge on the top side of a card
 * joins a related topic, and one on the bottom side an example.
 */
function isDependency(record) {
  const { fromSide, toSide } = edgeSides(record)
  return fromSide === 'right' && toSide === 'left'
}

/** What a search result calls a card: the name or label it shows, or its first line. */
export function cardName(node) {
  if (node.type === 'file' || node.type === 'link') return nodeTitleText(node)
  if (node.type === 'group') return node.label ?? ''
  if (node.type === 'text') return node.text.trim().split('\n')[0]
  return ''
}

/** One board's canvas, as `loadCanvas` takes it from a file. */
export function createModel() {
  /**
   * The file's nodes, in the file's order, and each edge between two of them as
   * `{ edge, fromNode, toNode }`, listed under both its nodes. The layout and
   * the dragging move and size these same node objects.
   */
  const model = { nodes: [], edgesByNode: new Map() }

  /**
   * Checks the canvas a file holds and takes it as the board's. Returns each
   * edge between two of its nodes as `{ edge, fromNode, toNode }`, in the file's
   * order. An edge to a node the file lacks is left out, with a warning.
   */
  function loadCanvas(data) {
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
      validateEdge(edge, index)
    }

    model.nodes = nodes
    const records = []
    for (const edge of edges) {
      const fromNode = nodesById.get(edge.fromNode)
      const toNode = nodesById.get(edge.toNode)
      if (!fromNode || !toNode) {
        console.warn(`edge ${edge.id} references a missing node`, edge)
        continue
      }

      const record = { edge, fromNode, toNode }
      records.push(record)
      indexEdge(model.edgesByNode, record)
    }

    return records
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
    return model.nodes.find(isLinked) ?? null
  }

  /**
   * The cards to preview around a card, in the given directions, each with the
   * dependency edge that joins it to the card and that edge's direction: `in`
   * for an edge into the card, from a card to read before it, and `out` for one
   * out of it, to a card to read after it. A card that several edges join in
   * one direction is previewed once in that direction, for the first of them.
   */
  function findNeighbours(node, directions) {
    const found = new Map()
    const attached = model.edgesByNode.get(node.id) ?? []
    for (const record of attached) {
      // An edge from a card to itself leads to no other card.
      if (record.fromNode === record.toNode) continue
      if (!isDependency(record)) continue

      const direction = record.toNode === node ? 'in' : 'out'
      if (!directions.has(direction)) continue
      const other = direction === 'in' ? record.fromNode : record.toNode
      const key = `${direction} ${other.id}`
      if (found.has(key)) continue
      found.set(key, { node: other, record, direction })
    }
    return [...found.values()]
  }

  return { model, loadCanvas, linkedCard, findNeighbours }
}
