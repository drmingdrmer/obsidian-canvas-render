const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test, expect } = require('@playwright/test')

const SCRIPT = path.join(__dirname, '..', 'sync-vault.sh')

// Writes { relative path: content } under root; a content of { link } makes a symlink.
function writeTree(root, tree) {
  for (const [relativePath, content] of Object.entries(tree)) {
    const file = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (typeof content === 'string') fs.writeFileSync(file, content)
    else fs.symlinkSync(content.link, file)
  }
}

// Reads back every file and symlink under root, in the shape writeTree takes,
// without following a symlink.
function readTree(root, directory = '') {
  const tree = {}
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relativePath = path.join(directory, entry.name)
    const file = path.join(root, relativePath)
    if (entry.isSymbolicLink()) tree[relativePath] = { link: fs.readlinkSync(file) }
    else if (entry.isDirectory()) Object.assign(tree, readTree(root, relativePath))
    else tree[relativePath] = fs.readFileSync(file, 'utf8')
  }
  return tree
}

// Runs sync-vault.sh from root/vault into root/bundle, for a canvas of file
// nodes, with args after the canvas file.
function syncVault(root, files, ...args) {
  const nodes = files.map((file, i) => ({ id: `n${i}`, type: 'file', file, x: 0, y: 0, width: 100, height: 100 }))
  writeTree(root, { 'bundle/board.canvas': JSON.stringify({ nodes }) })
  const canvasFile = path.join(root, 'bundle', 'board.canvas')
  return spawnSync('bash', [SCRIPT, path.join(root, 'vault'), canvasFile, ...args], { encoding: 'utf8' })
}

test('sync-vault.sh copies each file a canvas names into the canvas directory', async ({}, testInfo) => {
  const root = fs.realpathSync(testInfo.outputPath())
  writeTree(root, { 'vault/pages/n.md': 'note', 'vault/a b.png': 'image', 'vault/unused.md': 'unused' })
  const result = syncVault(root, ['pages/n.md', 'a b.png'])

  expect(result.stderr).toBe('')
  expect(result.stdout).toBe('pages/n.md\na b.png\n')
  expect(result.status).toBe(0)
  const tree = readTree(path.join(root, 'bundle'))
  delete tree['board.canvas']
  expect(tree).toEqual({ 'pages/n.md': 'note', 'a b.png': 'image' })
})

test('sync-vault.sh also copies the images a note embeds, found beside the note', async ({}, testInfo) => {
  const root = fs.realpathSync(testInfo.outputPath())
  const note = [
    '![a](../assets/figure.svg) ![b](<my figure.svg> "title") ![c](enc%20oded.svg) <img src="inline.svg">',
    '![d](missing.png) ![e](https://example.com/e.png) ![f](/f.png)',
  ].join('\n')
  const images = {
    'assets/figure.svg': 'figure',
    'pages/my figure.svg': 'my figure',
    'pages/enc oded.svg': 'encoded',
    'pages/inline.svg': 'inline',
  }
  writeTree(root, { 'vault/pages/n.md': note })
  for (const [image, content] of Object.entries(images)) writeTree(root, { [`vault/${image}`]: content })
  const result = syncVault(root, ['pages/n.md'])

  expect(result.stderr).toBe('skipped pages/missing.png, embedded in pages/n.md: not found in vault\n')
  expect(result.stdout).toBe(`pages/n.md\n${Object.keys(images).join('\n')}\n`)
  expect(result.status).toBe(0)
  const tree = readTree(path.join(root, 'bundle'))
  delete tree['board.canvas']
  expect(tree).toEqual({ 'pages/n.md': note, ...images })
})

test('sync-vault.sh looks for an image named by its file name alone in the attachment folder, then beside the note', async ({}, testInfo) => {
  const root = fs.realpathSync(testInfo.outputPath())
  const note = '![a](fig.svg) ![b](local.svg) ![c](both.svg) ![d](sub/deep.svg) ![e](gone.svg)'
  writeTree(path.join(root, 'vault'), {
    'pages/n.md': note,
    'assets/fig.svg': 'fig in the attachment folder',
    'pages/local.svg': 'local beside the note',
    'assets/both.svg': 'both in the attachment folder',
    'pages/both.svg': 'both beside the note',
    'assets/sub/deep.svg': 'deep under the attachment folder',
  })
  const result = syncVault(root, ['pages/n.md'], 'assets')

  expect(result.stderr).toBe([
    'skipped pages/sub/deep.svg, embedded in pages/n.md: not found in vault',
    'skipped assets/gone.svg or pages/gone.svg, embedded in pages/n.md: not found in vault',
    '',
  ].join('\n'))
  expect(result.stdout).toBe('pages/n.md\nassets/fig.svg\npages/local.svg\nassets/both.svg\n')
  expect(result.status).toBe(0)
  const tree = readTree(path.join(root, 'bundle'))
  delete tree['board.canvas']
  expect(tree).toEqual({
    'pages/n.md': note,
    'assets/fig.svg': 'fig in the attachment folder',
    'pages/local.svg': 'local beside the note',
    'assets/both.svg': 'both in the attachment folder',
  })
})

// The vault holds ok.md, out/n.md and escape.md, which embeds a file outside
// it; a symlink leaves it for secret/, and the bundle's own out/ is a symlink
// to elsewhere/.
const LAYOUT = {
  'vault/ok.md': 'ok',
  'vault/escape.md': '![](../outside.txt)',
  'vault/out/n.md': 'n',
  'vault/link': { link: '../secret' },
  'secret/secret.txt': 'secret',
  'outside.txt': 'outside',
  'bundle/out': { link: '../elsewhere' },
  'elsewhere/keep.txt': 'keep',
}

// [file node path, the error sync-vault.sh stops with, given the root]
const REFUSED = [
  ['../outside.txt', root => `outside ${root}/vault: ../outside.txt`],
  ['link/secret.txt', root => `outside ${root}/vault: link/secret.txt`],
  ['out/n.md', root => `outside ${root}/bundle: out/n.md`],
  ['/etc/hosts', () => 'not a relative path: /etc/hosts'],
  ['missing.md', root => `not found in vault: ${root}/vault/missing.md`],
  ['escape.md', root => `outside ${root}/vault: ../outside.txt`],
]

test('sync-vault.sh refuses a path that leaves the vault or the bundle, and copies nothing', async ({}, testInfo) => {
  for (const [index, [file, message]] of REFUSED.entries()) {
    const caseDir = testInfo.outputPath(String(index))
    fs.mkdirSync(caseDir)
    const root = fs.realpathSync(caseDir)
    writeTree(root, LAYOUT)
    const result = syncVault(root, ['ok.md', file])
    const tree = readTree(root)
    delete tree['bundle/board.canvas']

    expect.soft(result.stderr, file).toBe(`${message(root)}\n`)
    expect.soft(result.stdout, file).toBe('')
    expect.soft(result.status, file).toBe(1)
    expect.soft(tree, file).toEqual(LAYOUT)
  }
})

// [attachment folder, the error sync-vault.sh stops with, given the root]
const REFUSED_ATTACHMENTS = [
  ['../secret', root => `outside ${root}/vault: ../secret`],
  ['missing', () => 'not a folder in vault: missing'],
]

test('sync-vault.sh refuses an attachment folder the vault does not hold, and copies nothing', async ({}, testInfo) => {
  for (const [index, [attachments, message]] of REFUSED_ATTACHMENTS.entries()) {
    const caseDir = testInfo.outputPath(String(index))
    fs.mkdirSync(caseDir)
    const root = fs.realpathSync(caseDir)
    writeTree(root, LAYOUT)
    const result = syncVault(root, ['ok.md'], attachments)
    const tree = readTree(root)
    delete tree['bundle/board.canvas']

    expect.soft(result.stderr, attachments).toBe(`${message(root)}\n`)
    expect.soft(result.stdout, attachments).toBe('')
    expect.soft(result.status, attachments).toBe(1)
    expect.soft(tree, attachments).toEqual(LAYOUT)
  }
})
