import type { WasmToolchainTree } from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmToolchainFiles } from '@root/middleware/shared/ports/wasm-toolchain-types'

export type { WasmToolchainFiles }

type TreeNode = string | Uint8Array | WasmToolchainTree | undefined

/** True for file bytes, also when they come from another realm (a worker, a test environment). */
export const isFileBytes = (node: TreeNode): node is Uint8Array =>
  node !== undefined && typeof node !== 'string' && ArrayBuffer.isView(node)

const isDirectory = (node: TreeNode): node is WasmToolchainTree =>
  node !== undefined && typeof node !== 'string' && !ArrayBuffer.isView(node)

const splitPath = (path: string): string[] => {
  const parts = path.split('/')
  if (parts.length === 0 || parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`Invalid toolchain file path: '${path}'`)
  }
  return parts
}

/** Builds the nested tree clang works in from files keyed by relative path. */
export function filesToTree(files: WasmToolchainFiles): WasmToolchainTree {
  const tree: WasmToolchainTree = {}
  for (const [path, content] of Object.entries(files)) {
    const parts = splitPath(path)
    let node = tree
    for (const dir of parts.slice(0, -1)) {
      const next = node[dir]
      if (next === undefined) {
        const created: WasmToolchainTree = {}
        node[dir] = created
        node = created
      } else if (isDirectory(next)) {
        node = next
      } else {
        throw new Error(`Toolchain file path '${path}' goes through the file '${dir}'`)
      }
    }
    const name = parts[parts.length - 1]
    if (isDirectory(node[name])) throw new Error(`Toolchain file path '${path}' is also a directory`)
    node[name] = content
  }
  return tree
}

/** Reads one file from a tree, or `undefined` when the path is missing or is a directory. */
export function readTreeFile(tree: WasmToolchainTree, path: string): string | Uint8Array | undefined {
  let node: TreeNode = tree
  for (const part of splitPath(path)) {
    if (!isDirectory(node)) return undefined
    node = node[part]
  }
  return isDirectory(node) ? undefined : node
}
