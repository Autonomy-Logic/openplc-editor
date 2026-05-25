/**
 * Build a hierarchical tree from a `SystemLibrary` based on each POU's
 * `category` field.
 *
 * The category is a slash-separated path inherited from the source
 * .stlib manifest. POUs without a category land directly under the
 * library root; POUs with category like `"Engineering/control"` land
 * under nested `Engineering` → `control` folders.
 *
 * Folders nested at the same level appear before POUs (the same
 * "folders first" convention every other tree component in the editor
 * uses), and within each kind entries sort alphabetically.
 *
 * The tree is purely a presentation concern — the underlying
 * `SystemLibraryPou` objects flow through unchanged in `pou` leaves so
 * downstream consumers (block instantiation, drag payloads, completion
 * lookups) receive exactly what they did before hierarchy support.
 */

import type { SystemLibrary, SystemLibraryPou } from '../../middleware/shared/ports/library-types'

export type LibraryTreeNode =
  | { kind: 'folder'; label: string; children: LibraryTreeNode[] }
  | { kind: 'pou'; pou: SystemLibraryPou; libraryName: string }

/**
 * Build the tree for a single library. `filter`, when supplied, is
 * applied per-POU before insertion — folders containing no surviving
 * POUs are pruned automatically because they're never created.
 */
export function buildLibraryTree(
  library: SystemLibrary,
  filter?: (pou: SystemLibraryPou) => boolean,
): LibraryTreeNode & { kind: 'folder' } {
  const root: LibraryTreeNode & { kind: 'folder' } = {
    kind: 'folder',
    label: library.displayName ?? library.name,
    children: [],
  }
  // Cache by absolute path so repeated category prefixes reuse the
  // same folder node — without this, "POUs/Mathematical/Array" and
  // "POUs/Mathematical/Complex" would each create a fresh
  // "POUs/Mathematical" intermediate.
  const folderCache = new Map<string, LibraryTreeNode & { kind: 'folder' }>()
  folderCache.set('', root)

  const accept = filter ?? (() => true)
  for (const pou of library.pous) {
    if (!accept(pou)) continue
    const folder = ensureFolder(pou.category ?? '', folderCache)
    folder.children.push({ kind: 'pou', pou, libraryName: library.name })
  }

  sortNode(root)
  return root
}

function ensureFolder(
  path: string,
  cache: Map<string, LibraryTreeNode & { kind: 'folder' }>,
): LibraryTreeNode & { kind: 'folder' } {
  if (cache.has(path)) return cache.get(path)!
  const lastSlash = path.lastIndexOf('/')
  const parentPath = lastSlash === -1 ? '' : path.slice(0, lastSlash)
  const label = lastSlash === -1 ? path : path.slice(lastSlash + 1)
  const parent = ensureFolder(parentPath, cache)
  const folder: LibraryTreeNode & { kind: 'folder' } = {
    kind: 'folder',
    label,
    children: [],
  }
  parent.children.push(folder)
  cache.set(path, folder)
  return folder
}

function sortNode(node: LibraryTreeNode): void {
  if (node.kind !== 'folder') return
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    const labelA = a.kind === 'folder' ? a.label : a.pou.name
    const labelB = b.kind === 'folder' ? b.label : b.pou.name
    return labelA.localeCompare(labelB)
  })
  for (const c of node.children) sortNode(c)
}

/**
 * True when any POU under this subtree matches the predicate. Used by
 * the block picker / explorer to decide whether to render a library
 * folder at all when a search filter is active.
 */
export function libraryHasMatch(library: SystemLibrary, predicate: (pou: SystemLibraryPou) => boolean): boolean {
  return library.pous.some(predicate)
}
