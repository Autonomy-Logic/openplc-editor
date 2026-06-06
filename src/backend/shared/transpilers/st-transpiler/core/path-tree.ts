/**
 * Path-tree data model + algorithms — the LD/FBD core that turns a
 * graph walk into ST chunks.
 *
 * Mirrors `src/PLCGenerator/path_tree.ts` line-for-line but reads
 * from the JSON `LdBody` IR instead of `@xmldom` `Element`s.  The
 * algorithm itself (factorization, ComputePaths, pythonRepr-stable
 * keying) is pure JS and is preserved verbatim from the DOM walker.
 *
 * Chunks emitted here are the same `[text, location]` tuples the
 * existing transpiler produces, so downstream assembly stays
 * compatible.
 */

/* ─────────────────────────── chunk model ────────────────────────────────── */

export type LocationAtom = string | number | readonly (string | number)[]
export type Location = readonly LocationAtom[]
export type ProgramChunk = readonly [text: string, location: Location]

/* ─────────────────────────── path nodes ─────────────────────────────────── */

/**
 * One node in the path tree.  Same shape as the DOM walker's
 * `PathNode`; algorithms below are byte-faithful ports.
 */
export type PathNode =
  | { readonly kind: 'true' }
  | { readonly kind: 'leaf'; readonly chunks: readonly ProgramChunk[] }
  | { readonly kind: 'and'; readonly children: readonly PathNode[] }
  | { readonly kind: 'or'; readonly children: readonly PathNode[] }

export const TRUE_NODE: PathNode = { kind: 'true' }

export function leafNode(chunks: ProgramChunk[]): PathNode {
  return { kind: 'leaf', chunks }
}

/* ─────────────────────────── pythonRepr ─────────────────────────────────── */

/**
 * Stable structural key for a PathNode — used by `factorizePaths` to
 * detect common terms.  Identical to the Python `repr` output the
 * original xml2st pipeline keys on.
 */
export function pythonReprNode(node: PathNode): string {
  switch (node.kind) {
    case 'true':
      return 'None'
    case 'leaf':
      return pythonReprChunks(node.chunks)
    case 'and':
      return `[${node.children.map(pythonReprNode).join(', ')}]`
    case 'or':
      if (node.children.length === 0) return '()'
      if (node.children.length === 1) return `(${pythonReprNode(node.children[0])},)`
      return `(${node.children.map(pythonReprNode).join(', ')})`
  }
}

export function pythonReprChunks(chunks: readonly ProgramChunk[]): string {
  return `[${chunks.map(pythonReprChunk).join(', ')}]`
}

function pythonReprChunk(chunk: ProgramChunk): string {
  const [text, location] = chunk
  return `(${pythonReprString(text)}, ${pythonReprLocation(location)})`
}

function pythonReprLocation(loc: Location): string {
  if (loc.length === 0) return '()'
  if (loc.length === 1) return `(${pythonReprPrimitive(loc[0])},)`
  return `(${loc.map(pythonReprPrimitive).join(', ')})`
}

function pythonReprPrimitive(v: LocationAtom): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return '()'
    if (v.length === 1) return `(${pythonReprPrimitive(v[0])},)`
    return `(${v.map(pythonReprPrimitive).join(', ')})`
  }
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toString(10) : v.toString()
  }
  return pythonReprString(v as string)
}

export function pythonReprString(s: string): string {
  // Python prefers single quotes; switches to double quotes if the
  // string contains a `'` and not a `"`.
  const hasSingle = s.includes("'")
  const hasDouble = s.includes('"')
  const quote = hasSingle && !hasDouble ? '"' : "'"
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === quote) out += `\\${ch}`
    else if (ch === '\\') out += '\\\\'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else out += ch
  }
  return `${quote}${out}${quote}`
}

/* ─────────────────────────── factorizePaths ─────────────────────────────── */

/**
 * Boolean simplification — `(A AND B) OR (A AND C)` → `A AND (B OR C)`.
 *
 * Strategy mirrors `FactorizePaths` (PLCGenerator.py:1429):
 *   1. Sort the paths by their Python `repr`.
 *   2. For each pair, find common head/tail prefixes/suffixes between
 *      adjacent AND nodes.
 *   3. Replace with `[common_head, OR(unique_middles), common_tail]`.
 */
export function factorizePaths(paths: readonly PathNode[]): PathNode[] {
  if (paths.length <= 1) return [...paths]

  // Sort by stable repr key — same order Python produces.
  const sorted = pythonStableSort(paths)

  // Walk sorted list, group adjacent paths sharing head AND.
  const out: PathNode[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    // Find run of paths that share the same head/tail with sorted[i].
    while (j < sorted.length && canFactor(sorted[i], sorted[j])) j++
    if (j - i === 1) {
      out.push(sorted[i])
      i = j
      continue
    }
    // Build the factored shape.
    const group = sorted.slice(i, j)
    out.push(factorGroup(group))
    i = j
  }
  return out
}

/** Stable Python-style sort by `pythonReprNode` key. */
export function pythonStableSort(nodes: readonly PathNode[]): PathNode[] {
  return [...nodes].sort((a, b) => {
    const ka = pythonReprNode(a)
    const kb = pythonReprNode(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

/** Two paths can be factored if they share at least one head OR tail leaf. */
function canFactor(a: PathNode, b: PathNode): boolean {
  const aList = andChildren(a)
  const bList = andChildren(b)
  if (aList.length === 0 || bList.length === 0) return false
  return (
    pythonReprNode(aList[0]) === pythonReprNode(bList[0]) ||
    pythonReprNode(aList[aList.length - 1]) === pythonReprNode(bList[bList.length - 1])
  )
}

function andChildren(node: PathNode): readonly PathNode[] {
  return node.kind === 'and' ? node.children : [node]
}

function factorGroup(group: readonly PathNode[]): PathNode {
  // Find common head length and common tail length.
  const lists = group.map(andChildren)
  let headLen = 0
  outerHead: while (true) {
    const ref = lists[0][headLen]
    if (ref === undefined) break
    const refKey = pythonReprNode(ref)
    for (let k = 1; k < lists.length; k++) {
      if (lists[k][headLen] === undefined) break outerHead
      if (pythonReprNode(lists[k][headLen]) !== refKey) break outerHead
    }
    headLen++
  }
  let tailLen = 0
  outerTail: while (true) {
    const minLeft = Math.min(...lists.map((l) => l.length - headLen))
    if (tailLen >= minLeft) break
    const ref = lists[0][lists[0].length - 1 - tailLen]
    const refKey = pythonReprNode(ref)
    for (let k = 1; k < lists.length; k++) {
      if (pythonReprNode(lists[k][lists[k].length - 1 - tailLen]) !== refKey) break outerTail
    }
    tailLen++
  }

  const head = lists[0].slice(0, headLen)
  const tail = headLen + tailLen >= lists[0].length ? [] : lists[0].slice(lists[0].length - tailLen)
  const middles: PathNode[] = lists.map((l) => {
    const mid = l.slice(headLen, l.length - tailLen)
    if (mid.length === 0) return TRUE_NODE
    if (mid.length === 1) return mid[0]
    return { kind: 'and', children: mid }
  })

  const orNode: PathNode = { kind: 'or', children: pythonStableSort(middles) }
  const allChildren: PathNode[] = [...head, orNode, ...tail]
  if (allChildren.length === 1) return allChildren[0]
  return { kind: 'and', children: allChildren }
}

/* ─────────────────────────── computePaths ───────────────────────────────── */

/**
 * Turn a `PathNode` into its ST expression chunks.
 *
 * `first=true` at the outermost call suppresses the parenthesis
 * around the top-level OR — matches Python's `first` flag.
 */
export function computePaths(node: PathNode, first = false): ProgramChunk[] {
  switch (node.kind) {
    case 'true':
      return [['TRUE', []]]
    case 'leaf':
      return [...node.chunks]
    case 'and':
      return joinChunkLists(
        node.children.map((c) => computePaths(c)),
        [[' AND ', []]],
      )
    case 'or': {
      const inner = joinChunkLists(
        node.children.map((c) => computePaths(c)),
        [[' OR ', []]],
      )
      if (first) return inner
      const out: ProgramChunk[] = [['(', []]]
      out.push(...inner)
      out.push([')', []])
      return out
    }
  }
}

function joinChunkLists(
  groups: readonly (readonly ProgramChunk[])[],
  separator: readonly ProgramChunk[],
): ProgramChunk[] {
  const out: ProgramChunk[] = []
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) out.push(...separator)
    out.push(...groups[i])
  }
  return out
}
