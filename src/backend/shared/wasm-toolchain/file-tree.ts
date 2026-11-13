import type { WasmToolchainTree } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmToolchainFiles } from '@root/middleware/shared/ports/wasm-toolchain-types'

export type { WasmToolchainFiles }

type TreeNode = string | Uint8Array | WasmToolchainTree | undefined

/** True for file bytes, also when they come from another realm (a worker, a test environment). */
export const isFileBytes = (node: TreeNode): node is Uint8Array =>
  node !== undefined && typeof node !== 'string' && ArrayBuffer.isView(node)

const isDirectory = (node: TreeNode): node is WasmToolchainTree =>
  node !== undefined && typeof node !== 'string' && !ArrayBuffer.isView(node)

/** Segments that name object internals rather than files; a tree must never be walked through them. */
const RESERVED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

/** Why `path` cannot name a file in the toolchain's working directory, or `null` when it can. */
export function toolchainPathProblem(path: string): string | null {
  const parts = path.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    return `Invalid toolchain file path '${path}': it must be relative, without empty, '.' or '..' segments.`
  }
  const reserved = parts.find((p) => RESERVED_SEGMENTS.has(p))
  if (reserved !== undefined) return `Invalid toolchain file path '${path}': '${reserved}' is not allowed.`
  return null
}

const splitPath = (path: string): string[] => {
  const problem = toolchainPathProblem(path)
  if (problem !== null) throw new Error(problem)
  return path.split('/')
}

/** A directory node with no prototype, so no file name can reach object internals. */
function directory(): WasmToolchainTree {
  const node: WasmToolchainTree = {}
  Object.setPrototypeOf(node, null)
  return node
}

const child = (node: WasmToolchainTree, name: string): TreeNode =>
  Object.prototype.hasOwnProperty.call(node, name) ? node[name] : undefined

/** Builds the nested tree clang works in from files keyed by relative path. */
export function filesToTree(files: WasmToolchainFiles): WasmToolchainTree {
  const tree = directory()
  for (const [path, content] of Object.entries(files)) {
    const parts = splitPath(path)
    let node = tree
    for (const dir of parts.slice(0, -1)) {
      const next = child(node, dir)
      if (next === undefined) {
        const created = directory()
        node[dir] = created
        node = created
      } else if (isDirectory(next)) {
        node = next
      } else {
        throw new Error(`Toolchain file path '${path}' goes through the file '${dir}'.`)
      }
    }
    const name = parts[parts.length - 1]
    if (isDirectory(child(node, name))) throw new Error(`Toolchain file path '${path}' is also a directory.`)
    node[name] = content
  }
  return tree
}

/** Why these files cannot form one directory tree (a bad path, a file that is also a directory), or `null`. */
export function filesTreeProblem(files: WasmToolchainFiles): string | null {
  try {
    filesToTree(files)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Reads one file from a tree, or `undefined` when the path is missing, invalid or a directory. */
export function readTreeFile(tree: WasmToolchainTree, path: string): string | Uint8Array | undefined {
  if (toolchainPathProblem(path) !== null) return undefined
  let node: TreeNode = tree
  for (const part of path.split('/')) {
    if (!isDirectory(node)) return undefined
    node = child(node, part)
  }
  return isDirectory(node) ? undefined : node
}
