import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

/** The `@electron/asar` release the published patch method runs through `npx`. */
export const ASAR_CLI_PACKAGE = '@electron/asar@3.2.18'

/**
 * Reads the header of an asar archive: an 8-byte size pickle, then a pickle holding the header JSON string.
 * @param {string} archivePath
 * @returns {{ header: object, headerSize: number }} file data starts at byte `8 + headerSize`.
 */
export function readAsarHeader(archivePath) {
  const fd = openSync(archivePath, 'r')
  try {
    const sizePickle = Buffer.alloc(8)
    if (readSync(fd, sizePickle, 0, 8, 0) !== 8) throw new Error(`${archivePath} is too short to be an asar archive`)
    const headerSize = sizePickle.readUInt32LE(4)
    const headerPickle = Buffer.alloc(headerSize)
    if (readSync(fd, headerPickle, 0, headerSize, 8) !== headerSize) {
      throw new Error(`${archivePath} ends inside its asar header`)
    }
    const length = headerPickle.readUInt32LE(4)
    return { header: JSON.parse(headerPickle.toString('utf8', 8, 8 + length)), headerSize }
  } finally {
    closeSync(fd)
  }
}

/**
 * The header node at an archive path, or undefined when the path is absent.
 * @param {object} header
 * @param {string} pathInArchive
 * @returns {{ node: object | undefined, unpacked: boolean }} `unpacked` is true when the node or a parent is unpacked.
 */
function nodeAt(header, pathInArchive) {
  let node = header
  let unpacked = false
  for (const segment of pathInArchive.split('/').filter((part) => part !== '' && part !== '.')) {
    const children = node.files
    if (!children || !Object.prototype.hasOwnProperty.call(children, segment)) return { node: undefined, unpacked }
    node = children[segment]
    unpacked = unpacked || node.unpacked === true
  }
  return { node, unpacked }
}

/** True for a header node that is a regular file. */
function isFileNode(node) {
  return node !== undefined && node.files === undefined && node.link === undefined
}

/**
 * The archive paths of the regular files directly inside a directory of the archive, sorted.
 * @param {string} archivePath
 * @param {string} dirInArchive for example `dist/main`.
 * @returns {string[]}
 * @throws {Error} naming the directory when the archive holds no such directory.
 */
export function listFiles(archivePath, dirInArchive) {
  const { node } = nodeAt(readAsarHeader(archivePath).header, dirInArchive)
  if (!node || !node.files) throw new Error(`${archivePath} holds no directory ${dirInArchive}`)
  return Object.entries(node.files)
    .filter(([, child]) => isFileNode(child))
    .map(([name]) => `${dirInArchive.replace(/\/+$/, '')}/${name}`)
    .sort()
}

/**
 * Where a packed file's bytes sit in the archive file.
 * @param {string} archivePath
 * @param {string} pathInArchive
 * @returns {{ offset: number, size: number }} `offset` is absolute in the archive file.
 * @throws {Error} naming the path when it is missing, not a regular file, or unpacked to `app.asar.unpacked`.
 */
export function locateFile(archivePath, pathInArchive) {
  const { header, headerSize } = readAsarHeader(archivePath)
  const { node, unpacked } = nodeAt(header, pathInArchive)
  if (node === undefined) throw new Error(`${pathInArchive} is not in ${archivePath}`)
  if (!isFileNode(node)) throw new Error(`${pathInArchive} is not a regular file in ${archivePath}`)
  if (unpacked) throw new Error(`${pathInArchive} is unpacked: it lives in ${archivePath}.unpacked, not in the archive`)
  return { offset: 8 + headerSize + Number(node.offset), size: Number(node.size) }
}

/**
 * The bytes of a file of the archive, read from `<archivePath>.unpacked` when the entry is unpacked.
 * @param {string} archivePath
 * @param {string} pathInArchive
 * @returns {Buffer}
 */
export function readArchiveFile(archivePath, pathInArchive) {
  const { header } = readAsarHeader(archivePath)
  const { node, unpacked } = nodeAt(header, pathInArchive)
  if (!isFileNode(node)) throw new Error(`${pathInArchive} is not a regular file in ${archivePath}`)
  if (unpacked) return readFileSync(join(`${archivePath}.unpacked`, ...pathInArchive.split('/')))
  const { offset, size } = locateFile(archivePath, pathInArchive)
  const bytes = Buffer.alloc(size)
  const fd = openSync(archivePath, 'r')
  try {
    if (readSync(fd, bytes, 0, size, offset) !== size) throw new Error(`${archivePath} ends inside ${pathInArchive}`)
  } finally {
    closeSync(fd)
  }
  return bytes
}

/**
 * Every regular file of the archive with its unpacked flag, as archive paths.
 * @param {object} header
 * @returns {{ path: string, unpacked: boolean, executable: boolean }[]}
 */
export function archiveFiles(header) {
  const files = []
  const pending = [{ node: header, path: '', unpacked: false }]
  while (pending.length > 0) {
    const { node, path, unpacked } = pending.pop()
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const childPath = path === '' ? name : `${path}/${name}`
      const childUnpacked = unpacked || child.unpacked === true
      if (child.files) pending.push({ node: child, path: childPath, unpacked: childUnpacked })
      else if (child.link === undefined) {
        files.push({ path: childPath, unpacked: childUnpacked, executable: child.executable === true })
      }
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * Writes every file of the archive into `destDir`, which is created; unpacked entries are copied from
 * `<archivePath>.unpacked` and symbolic links are recreated.
 * @param {string} archivePath
 * @param {string} destDir
 */
export function extractAsar(archivePath, destDir) {
  const { header, headerSize } = readAsarHeader(archivePath)
  mkdirSync(destDir, { recursive: true })
  const fd = openSync(archivePath, 'r')
  try {
    const pending = [{ node: header, path: [], unpacked: false }]
    while (pending.length > 0) {
      const { node, path, unpacked } = pending.pop()
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const childPath = [...path, name]
        const target = join(destDir, ...childPath)
        const childUnpacked = unpacked || child.unpacked === true
        if (child.files) {
          mkdirSync(target, { recursive: true })
          pending.push({ node: child, path: childPath, unpacked: childUnpacked })
          continue
        }
        mkdirSync(dirname(target), { recursive: true })
        if (child.link !== undefined) {
          symlinkSync(child.link, target)
          continue
        }
        if (childUnpacked) {
          copyFileSync(join(`${archivePath}.unpacked`, ...childPath), target)
        } else {
          const size = Number(child.size)
          const bytes = Buffer.alloc(size)
          if (readSync(fd, bytes, 0, size, 8 + headerSize + Number(child.offset)) !== size) {
            throw new Error(`${archivePath} ends inside ${childPath.join('/')}`)
          }
          writeFileSync(target, bytes)
        }
        if (child.executable === true) chmodSync(target, 0o755)
      }
    }
  } finally {
    closeSync(fd)
  }
}

/**
 * Runs the pinned `@electron/asar` command line through `npx`, as the published patch method does.
 * @param {string[]} args for example `['extract', archive, dir]`.
 * @param {{ cwd?: string, timeoutMs?: number }} [options]
 * @returns {{ status: number | null, signal: string | null, stdout: string, stderr: string, error?: Error }}
 */
export function runAsarCli(args, options = {}) {
  const npxArgs = ['--yes', ASAR_CLI_PACKAGE, ...args]
  const spawnOptions = { cwd: options.cwd, encoding: 'utf8', timeout: options.timeoutMs ?? 600_000 }
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"npx ${npxArgs.map(quoteForCmd).join(' ')}"`], {
          ...spawnOptions,
          windowsVerbatimArguments: true,
        })
      : spawnSync('npx', npxArgs, spawnOptions)
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  }
}

/** Quotes one argument for a `cmd.exe /s /c` command line. */
function quoteForCmd(arg) {
  return /^[\w@./:=\\-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '""')}"`
}
