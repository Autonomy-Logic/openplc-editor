/**
 * LD/FBD path-tree construction, factorization, and ST emission.
 *
 * Mirrors `PouProgramGenerator.GeneratePaths` (PLCGenerator.py:1807),
 * `FactorizePaths` (PLCGenerator.py:1429), `ComputePaths` (PLCGenerator.py:1924),
 * and `ComputeExpression` (PLCGenerator.py:1942).
 *
 * **Data model divergence (intentional, documented)**: Python represents
 * paths as a mix of `None`, `str`, `list`, and `tuple` and uses
 * ``str(path)`` / ``eval(path)`` to serialize-and-revive leaves through
 * the factorization step. The TS port uses a discriminated
 * ``PathNode`` union (`true`, `leaf`, `and`, `or`) and a separate
 * ``pythonRepr`` helper for stable structural keying / Python-equivalent
 * sort ordering. The semantic contract is preserved — the emitted ST
 * chunks must be byte-identical.
 *
 * Phase 4c/d/e scope:
 *   - GeneratePaths branches: LeftPowerRail / InVariable / InOutVariable /
 *     Contact / Coil ported.
 *   - Block / Continuation / Connector branches throw `NotYetImplementedError`
 *     (block lands in Phase 4f, continuations/connectors when SFC needs
 *     them in Phase 6).
 */

import {
  getconnectionPointIn,
  getconnectionPointOut,
  getconnections,
  getcontentInstance,
  getexecutionOrderId,
  getexpression,
  getformalParameter,
  getinputVariables,
  getinstanceName,
  getlocalId,
  getoutputVariables,
  getposition,
  getpositions,
  getrefLocalId,
  getrelPositionXY,
  gettypeName,
  getvariable,
  getvariableText,
  InstanceTag,
} from '../plcopen/accessors'
import { type Element, getLocalTag } from '../xmlclass/xsdschema'
import {
  type BlockInfos,
  GetBlockType,
  synthesizePermissiveBlockInfos,
} from './block_library'
import { PLCGenException } from './connection_types'
import type { GenState } from './gen_state'
import { extractModifier } from './modifiers'
import type { Location, ProgramChunk } from './program'
import { NotYetImplementedError } from './program'

/* ─────────────────────────── data model ─────────────────────────────────── */

/**
 * One node in the path tree.
 *
 *   - `true`: corresponds to Python `None`. Emitted by the LeftPowerRail
 *     branch — represents "logic 1" / unconditionally TRUE.
 *   - `leaf`: corresponds to a Python string holding the `repr` of a chunk
 *     list. The leaf carries the actual chunks; we lazily render them via
 *     `pythonRepr` when grouping.
 *   - `and`: corresponds to a Python `list`. ComputePaths emits the children
 *     joined by ` AND `.
 *   - `or`: corresponds to a Python `tuple`. ComputePaths emits the children
 *     joined by ` OR `, wrapped in parentheses unless it's the outermost call.
 */
export type PathNode =
  | { readonly kind: 'true' }
  | { readonly kind: 'leaf'; readonly chunks: readonly ProgramChunk[] }
  | { readonly kind: 'and'; readonly children: readonly PathNode[] }
  | { readonly kind: 'or'; readonly children: readonly PathNode[] }

const TRUE_NODE: PathNode = { kind: 'true' }

/* ─────────────────────────── pythonRepr ──────────────────────────────────── */

/**
 * Render `value` to the exact string Python's built-in `repr` (or `str` for
 * containers) would produce. The contract is byte-identical: my chunks
 * passed through this function MUST produce the same string Python writes,
 * because Factorization keys on it.
 *
 * Supports the value types our pipeline produces:
 *   - `null`         → `"None"`
 *   - `string`       → quoted-and-escaped per Python's rules
 *   - `number`       → integer or float repr (we only emit integers from chunks)
 *   - `boolean`      → `"True"` / `"False"`
 *   - tuple (array marked with sentinel `kind: 'tuple'`) — handled via
 *     `pythonReprNode` for `PathNode`s; for raw values we use a wrapper
 *     `{kind: 'tuple', items}` to disambiguate from list.
 *   - array          → `"[item1, item2, ...]"`
 *
 * For PathNode encoding we call `pythonReprNode`.
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

/**
 * Render a chunk list as Python would render the equivalent `list` of
 * `(text, location_tuple)` tuples.
 */
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

function pythonReprPrimitive(v: string | number | readonly (string | number)[]): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return '()'
    if (v.length === 1) return `(${pythonReprPrimitive(v[0])},)`
    return `(${v.map(pythonReprPrimitive).join(', ')})`
  }
  if (typeof v === 'number') {
    // Locations only carry integers; emit as Python int.
    return Number.isInteger(v) ? v.toString(10) : v.toString()
  }
  return pythonReprString(v as string)
}

/**
 * Python-style string repr. Python prefers single quotes; switches to
 * double if the string contains a single but not a double; uses single
 * with backslash-escaped singles otherwise. Backslashes and a few
 * control characters get escaped.
 */
export function pythonReprString(s: string): string {
  const hasSingle = s.includes("'")
  const hasDouble = s.includes('"')
  const useDouble = hasSingle && !hasDouble
  const quote = useDouble ? '"' : "'"
  let out = quote
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\\') out += '\\\\'
    else if (ch === quote) out += '\\' + quote
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (code < 0x20 || code === 0x7f) {
      out += '\\x' + code.toString(16).padStart(2, '0')
    } else {
      out += ch
    }
  }
  out += quote
  return out
}

/* ────────────────────── python2sort equivalent ─────────────────────────── */

/**
 * Mirror of ``util.py2sort.python2sort`` — group items by comparability,
 * sort within each group, then chain.
 *
 * Two PathNodes are considered comparable when they have the same `kind`.
 * Within a group, order is determined by `pythonReprNode` lexicographic
 * comparison — Python compares lists element-wise, tuples element-wise,
 * strings byte-wise, and the repr round-trips give equivalent ordering
 * for the value types our pipeline emits.
 */
export function pythonStableSort(nodes: readonly PathNode[]): PathNode[] {
  if (nodes.length === 0) return []
  const groups: PathNode[][] = [[nodes[0]]]
  for (let i = 1; i < nodes.length; i++) {
    const item = nodes[i]
    let placed = false
    for (const group of groups) {
      if (group[0].kind === item.kind) {
        group.push(item)
        placed = true
        break
      }
    }
    if (!placed) groups.push([item])
  }
  for (const group of groups) {
    group.sort((a, b) => {
      const ra = pythonReprNode(a)
      const rb = pythonReprNode(b)
      return ra < rb ? -1 : ra > rb ? 1 : 0
    })
  }
  return groups.flat()
}

/* ────────────────────────── factorizePaths ──────────────────────────────── */

/**
 * Factor common suffixes out of a list of paths.
 *
 * Mirrors `PouProgramGenerator.FactorizePaths` (PLCGenerator.py:1429).
 * Only AND-paths (`kind: 'and'`) with more than one child are eligible —
 * other paths pass through unchanged. Paths whose **last** child is
 * structurally equal get their prefixes grouped into a new AND-path with
 * the prefixes wrapped in an OR-node.
 */
export function factorizePaths(paths: readonly PathNode[]): PathNode[] {
  const samePaths = new Map<string, { prefix: PathNode[]; num: number }[]>()
  const factorized: PathNode[] = []
  const uncomputedIndex = new Set<number>()
  for (let i = 0; i < paths.length; i++) uncomputedIndex.add(i)

  for (let num = 0; num < paths.length; num++) {
    const path = paths[num]
    if (path.kind === 'and' && path.children.length > 1) {
      const last = path.children[path.children.length - 1]
      const key = pythonReprNode({ kind: 'and', children: [last] })
      const bucket = samePaths.get(key) ?? []
      bucket.push({ prefix: path.children.slice(0, -1), num })
      samePaths.set(key, bucket)
    } else {
      factorized.push(path)
      uncomputedIndex.delete(num)
    }
  }

  for (const [key, elements] of samePaths) {
    if (elements.length <= 1) continue
    const innerPaths = elements.map(
      (e): PathNode =>
        e.prefix.length === 1 ? e.prefix[0] : { kind: 'and', children: e.prefix },
    )
    // Decode the key back into the [lastChild] list, then peel off lastChild.
    const innerFactorized = factorizePaths(innerPaths)
    // Reconstruct the "common tail" from the key — but easier: just take
    // the last child from any element; they're structurally equal by key.
    const lastChildKey = key // == pythonReprNode({kind:'and', children:[lastChild]})
    // We already have all elements that grouped under this key; the last
    // child of each prefix path is the same. Use the first element's
    // ORIGINAL last child (paths[elements[0].num].children[-1]).
    const firstOriginal = paths[elements[0].num]
    if (firstOriginal.kind !== 'and') continue // unreachable, but narrow types
    const lastChild = firstOriginal.children[firstOriginal.children.length - 1]
    // Suppress unused-var lint — keep the variable readable in the comment above.
    void lastChildKey

    let newPath: PathNode
    if (innerFactorized.length > 1) {
      // `[tuple(inner), lastChild]` in Python.
      newPath = {
        kind: 'and',
        children: [{ kind: 'or', children: innerFactorized }, lastChild],
      }
    } else {
      // `inner + [lastChild]` in Python — when inner is a single AND-path,
      // unwrap and concat; otherwise wrap.
      const inner = innerFactorized[0]
      const innerChildren = inner.kind === 'and' ? inner.children : [inner]
      newPath = { kind: 'and', children: [...innerChildren, lastChild] }
    }
    factorized.push(newPath)
    for (const e of elements) uncomputedIndex.delete(e.num)
  }

  for (const num of [...uncomputedIndex].sort((a, b) => a - b)) {
    factorized.push(paths[num])
  }

  return pythonStableSort(factorized)
}

/* ────────────────────────── computePaths ───────────────────────────────── */

/**
 * Render a PathNode tree to ST chunks. Mirrors `ComputePaths`
 * (PLCGenerator.py:1924).
 *
 *   - `or`: parenthesize and join children with ` OR `. The outermost
 *     call (`first === true`) skips the parens (matches Python).
 *   - `and`: join children with ` AND ` (never parenthesized — context
 *     governs grouping).
 *   - `true`: emit `[("TRUE", [])]`.
 *   - `leaf`: emit the carried chunks.
 *
 * An `or` group that contains any `true` child short-circuits to
 * `[("TRUE", [])]` — matches Python's `if None in paths` check.
 */
export function computePaths(paths: PathNode, first = false): ProgramChunk[] {
  if (paths.kind === 'or') {
    if (paths.children.some((c) => c.kind === 'true')) {
      return [['TRUE', []]]
    }
    const childChunks = paths.children.map((c) => computePaths(c))
    const joined = joinChunkLists([[' OR ', []]], childChunks)
    if (first) return joined
    return [['(', []], ...joined, [')', []]]
  }
  if (paths.kind === 'and') {
    const childChunks = paths.children.map((c) => computePaths(c))
    return joinChunkLists([[' AND ', []]], childChunks)
  }
  if (paths.kind === 'true') {
    return [['TRUE', []]]
  }
  return [...paths.chunks]
}

/**
 * `JoinList(separator, items)` from PLCGenerator.py:98 — interleave a
 * separator chunk list between adjacent items.
 */
function joinChunkLists(
  separator: readonly ProgramChunk[],
  items: readonly (readonly ProgramChunk[])[],
): ProgramChunk[] {
  const out: ProgramChunk[] = []
  for (let i = 0; i < items.length; i++) {
    if (i > 0) out.push(...separator)
    out.push(...items[i])
  }
  return out
}

/* ────────────────────────── generatePaths ──────────────────────────────── */

/**
 * Recursive path-tree builder.
 *
 * Mirrors `PouProgramGenerator.GeneratePaths` (PLCGenerator.py:1807).
 * Given a list of `<connection>` elements (links inside some
 * `<connectionPointIn>`), produce a list of PathNodes representing the
 * upstream logic feeding each connection.
 *
 * `order` and `toInout` are plumbed through for the Block branch (Phase 4f)
 * — they're context flags the generator forwards into `GenerateBlock`.
 */
export function generatePaths(
  state: GenState,
  connections: readonly Element[],
  body: Element,
  order = false,
  toInout = false,
): PathNode[] {
  const paths: PathNode[] = []

  for (const connection of connections) {
    const localId = getrefLocalId(connection)
    if (localId === null) continue
    const next = getcontentInstance(body, localId)
    if (!next) continue
    const tag = getLocalTag(next)

    switch (tag) {
      case InstanceTag.LeftPowerRail:
        paths.push(TRUE_NODE)
        break

      case InstanceTag.InVariable:
      case InstanceTag.InOutVariable: {
        const expr = getexpression(next) ?? ''
        const chunks: ProgramChunk[] = [
          [
            expr,
            [state.tagName, 'io_variable', localId, 'expression'],
          ],
        ]
        paths.push({ kind: 'leaf', chunks })
        break
      }

      case InstanceTag.Block: {
        // Phase 4f: dispatch to generateBlock. The block_infos lookup chain
        // mirrors PLCGenerator.py:1828-1841 — overload-narrowed first, then
        // generic catalog, then permissive synth.
        const typeName = gettypeName(next) ?? ''
        const inputWrapper = getinputVariables(next)
        const callerInputTypes: string[] = inputWrapper
          ? getvariable(inputWrapper)
              .filter((v) => getformalParameter(v) !== 'EN')
              .map((v) => {
                const cp = getconnectionPointIn(v)
                if (!cp) return 'ANY'
                return state.connectionTypes.get(cp) ?? 'ANY'
              })
          : []
        let blockInfos: BlockInfos | null =
          state.project !== null
            ? GetBlockType(state.project, typeName, callerInputTypes)
            : null
        if (blockInfos === null && state.project !== null) {
          blockInfos = GetBlockType(state.project, typeName)
        }
        if (blockInfos === null) {
          blockInfos = synthesizePermissiveBlockInfos(next)
        }
        let outputChunks: ProgramChunk[] | undefined
        try {
          outputChunks = generateBlock(
            state,
            next,
            blockInfos,
            body,
            connection,
            order,
            toInout,
          )
        } catch (e) {
          if (e instanceof Error) {
            throw new PLCGenException(e.message)
          }
          throw e
        }
        if (outputChunks !== undefined) {
          paths.push({ kind: 'leaf', chunks: outputChunks })
        }
        break
      }

      case InstanceTag.Continuation:
        // No corpus coverage yet — Continuation/Connector lands when SFC
        // sub-POU generation arrives (Phase 6+).
        throw new NotYetImplementedError(`generatePaths ${tag} branch`)

      case InstanceTag.Contact: {
        const contactInfo: Location = [
          state.tagName,
          'contact',
          localId,
        ]
        const variableChunks: ProgramChunk[] = [
          [getvariableText(next), [...contactInfo, 'reference']],
        ]
        const variableLeaf: PathNode = {
          kind: 'leaf',
          chunks: extractModifier(state, next, variableChunks, contactInfo),
        }

        const cpIn = getconnectionPointIn(next)
        const upstreamConnections = cpIn ? getconnections(cpIn) : []
        const result = generatePaths(state, upstreamConnections, body, order)

        if (result.length === 0) {
          throw new PLCGenException(
            `Contact "${getvariableText(next)}" in POU "${state.pou.localName}" must be connected.`,
          )
        }

        if (result.length > 1) {
          const factorized = factorizePaths(result)
          if (factorized.length > 1) {
            paths.push({
              kind: 'and',
              children: [variableLeaf, { kind: 'or', children: factorized }],
            })
          } else {
            // result is `factorized[0]`; concat the variable head with it.
            const tail = factorized[0]
            const tailChildren = tail.kind === 'and' ? tail.children : [tail]
            paths.push({ kind: 'and', children: [variableLeaf, ...tailChildren] })
          }
        } else {
          const only = result[0]
          if (only.kind === 'and') {
            paths.push({ kind: 'and', children: [variableLeaf, ...only.children] })
          } else if (only.kind !== 'true') {
            paths.push({ kind: 'and', children: [variableLeaf, only] })
          } else {
            // Single direct LeftPowerRail input — emit just the variable.
            paths.push(variableLeaf)
          }
        }
        break
      }

      case InstanceTag.Coil: {
        const cpIn = getconnectionPointIn(next)
        const upstreamConnections = cpIn ? getconnections(cpIn) : []
        paths.push(...generatePaths(state, upstreamConnections, body, order))
        break
      }

      default:
        // Unknown instance type — silently skip (matches Python's `elif`
        // chain that falls through without action).
        break
    }
  }

  return paths
  // `toInout` is unused in Phase 4c; consumed by the Block branch in 4f.
  void toInout
}

/* ─────────────────────── computeExpression ─────────────────────────────── */

/**
 * Build the ST expression chunks that feed a connection point.
 * Mirrors `ComputeExpression` (PLCGenerator.py:1942).
 *
 * Returns `null` when there are no upstream connections (an empty rung).
 */
export function computeExpression(
  state: GenState,
  body: Element,
  connections: readonly Element[],
  order = false,
  toInout = false,
): ProgramChunk[] | null {
  const paths = generatePaths(state, connections, body, order, toInout)
  if (paths.length === 0) return null

  let final: PathNode
  if (paths.length > 1) {
    const factorized = factorizePaths(paths)
    if (factorized.length > 1) {
      final = { kind: 'or', children: factorized }
    } else {
      final = factorized[0]
    }
  } else {
    final = paths[0]
  }
  return computePaths(final, true)
}

/* ─────────────────────────── generateBlock ─────────────────────────────── */

/**
 * Emit a block call into `state.program` and return the chunks that
 * reference its output (for the caller — typically `generatePaths`'s Block
 * branch — to splice into the path tree).
 *
 * Mirrors `PouProgramGenerator.GenerateBlock` (PLCGenerator.py:1457). This
 * is the heaviest single function in the codebase; the port preserves the
 * Python control flow verbatim, with helpers named to match.
 *
 * Side effects:
 *   - `state.program`: appends the `instance(arg1, arg2, ...);` call (FB)
 *     or the `temp := type(arg1, arg2);` call (function) — but only on the
 *     first visit per block (deduped via `state.computedBlocks`).
 *   - `state.iface`: may append a synthesized `_TMP_*` or `name_param` VAR
 *     entry for function temporaries / FB inout aliases.
 *   - `state.warnings`: appends a warning when a function block has no
 *     connected inputs (matches Python's `self.Warnings.append`).
 *
 * Returns:
 *   - `link === null`: undefined. The block was emitted as a side effect
 *     but the caller doesn't need an output reference.
 *   - `link !== null` and an output variable matches: the chunks describing
 *     that output's reference (e.g. `[("TON0.Q", ...)]`), with
 *     `extractModifier` already applied.
 *   - `link !== null` but no output variable matches: throws (matches
 *     Python's `raise ValueError`).
 */
export function generateBlock(
  state: GenState,
  block: Element,
  blockInfos: BlockInfos,
  body: Element,
  link: Element | null,
  order = false,
  toInout = false,
): ProgramChunk[] | undefined {
  const instanceName = getinstanceName(block)
  const blockType = gettypeName(block) ?? ''
  const executionOrderId = getexecutionOrderId(block) ?? 0
  const localId = getlocalId(block)
  if (localId === null) {
    throw new Error(`generateBlock: <block typeName="${blockType}"> missing @localId`)
  }

  const inputWrapper = getinputVariables(block)
  const outputWrapper = getoutputVariables(block)
  const inputVariables = inputWrapper ? getvariable(inputWrapper) : []
  const outputVariables = outputWrapper ? getvariable(outputWrapper) : []

  // VAR_IN_OUT detection: a parameter name that appears in BOTH the input
  // wrapper and the output wrapper. Stored as a name → expression map,
  // populated below by the function-branch emit pass.
  const inoutVariables = new Map<string, ProgramChunk[]>()
  for (const iv of inputVariables) {
    const ip = getformalParameter(iv)
    if (ip === null) continue
    for (const ov of outputVariables) {
      if (getformalParameter(ov) === ip) {
        inoutVariables.set(ip, [])
      }
    }
  }

  const inputNames = blockInfos.inputs.map((io) => io.name)
  const outputNames = blockInfos.outputs.map((io) => io.name)

  if (blockInfos.type === 'function') {
    emitFunctionCall(
      state,
      block,
      blockInfos,
      body,
      blockType,
      instanceName,
      localId,
      executionOrderId,
      inputVariables,
      outputVariables,
      inputNames,
      outputNames,
      inoutVariables,
      order,
    )
  } else if (blockInfos.type === 'functionBlock') {
    emitFunctionBlockCall(
      state,
      block,
      blockInfos,
      body,
      instanceName,
      localId,
      executionOrderId,
      inputVariables,
      inputNames,
      inoutVariables,
      order,
    )
  }

  // Output-return logic. Mirrors PLCGenerator.py:1692-1805.
  return resolveBlockOutput(
    state,
    block,
    blockInfos,
    body,
    link,
    instanceName,
    blockType,
    localId,
    executionOrderId,
    inputVariables,
    outputVariables,
    outputNames,
    inoutVariables,
    toInout,
  )
}

/* ────────────────────── function branch (emit) ─────────────────────────── */

function emitFunctionCall(
  state: GenState,
  block: Element,
  blockInfos: BlockInfos,
  body: Element,
  blockType: string,
  instanceName: string | null,
  localId: number,
  executionOrderId: number,
  inputVariables: Element[],
  outputVariables: Element[],
  inputNames: string[],
  outputNames: string[],
  inoutVariables: Map<string, ProgramChunk[]>,
  order: boolean,
): void {
  if (state.computedBlocks.get(block) === true || order) return
  state.computedBlocks.set(block, true)

  // Build the param → variable map and the iteration order for inputs.
  // Mirrors PLCGenerator.py:1498-1521 (EN-handling + extensible split).
  const inputConnected = new Map<string, Element | null>()
  let inputParameters: string[]

  if (!blockInfos.extensible) {
    inputConnected.set('EN', null)
    for (const n of inputNames) inputConnected.set(n, null)
    for (const variable of inputVariables) {
      const parameter = getformalParameter(variable)
      if (parameter !== null && inputConnected.has(parameter)) {
        inputConnected.set(parameter, variable)
      }
    }
    if (inputConnected.get('EN') === null) {
      inputConnected.delete('EN')
      inputParameters = [...inputNames]
    } else {
      inputParameters = ['EN', ...inputNames]
    }
  } else {
    for (const variable of inputVariables) {
      const parameter = getformalParameter(variable)
      if (parameter !== null) inputConnected.set(parameter, variable)
    }
    inputParameters = inputVariables
      .map((v) => getformalParameter(v))
      .filter((n): n is string => n !== null)
  }

  // First pass: build `connected_vars` as label/expression pairs.
  let oneInputConnected = false
  let allInputConnected = true
  const connectedVars: { label: ProgramChunk[]; expr: ProgramChunk[] }[] = []

  for (let i = 0; i < inputParameters.length; i++) {
    const parameter = inputParameters[i]
    const variable = inputConnected.get(parameter) ?? null
    if (variable === null) {
      allInputConnected = false
      continue
    }
    const inputInfo: Location = [state.tagName, 'block', localId, 'input', i]
    const cpIn = getconnectionPointIn(variable)
    const connections = cpIn ? getconnections(cpIn) : []
    if (connections.length === 0) {
      allInputConnected = false
      continue
    }
    if (parameter !== 'EN') oneInputConnected = true

    let expression: ProgramChunk[] | null
    if (inoutVariables.has(parameter)) {
      expression = computeExpression(state, body, connections, executionOrderId > 0, true)
      if (expression === null) {
        raiseUnconnectedInOutError(instanceName, blockInfos.name, parameter, state)
      } else {
        inoutVariables.set(parameter, expression)
      }
    } else {
      expression = computeExpression(state, body, connections, executionOrderId > 0)
    }
    if (expression === null) continue

    connectedVars.push({
      label: [
        [parameter, inputInfo],
        [' := ', []],
      ],
      expr: extractModifier(state, variable, expression, inputInfo),
    })
  }

  // Decide named vs positional argument syntax. Mirrors lines 1565-1568.
  const useNamedArgs = outputVariables.length > 1 || !allInputConnected
  const vars: ProgramChunk[][] = useNamedArgs
    ? connectedVars.map((cv) => [...cv.label, ...cv.expr])
    : connectedVars.map((cv) => cv.expr)

  if (!oneInputConnected) {
    state.warnings.push(
      `"${blockInfos.name}" function cancelled in "${state.tagName.split('::').pop() ?? ''}" POU: No input connected`,
    )
    return
  }

  // Emit the temporary-variable assignment line(s):
  //   <output_name> := <type>(<arg1>, <arg2>, ...);
  // For multi-output functions, each extra output becomes a `name => var`
  // named-output arg in the call. The "primary" output drives the LHS.
  let outputName: string | null = null
  let outputInfo: Location | null = null

  for (let i = 0; i < outputVariables.length; i++) {
    const variable = outputVariables[i]
    const parameter = getformalParameter(variable) ?? ''
    if (
      !inoutVariables.has(parameter) &&
      (outputNames.includes(parameter) || parameter === '' || parameter === 'ENO')
    ) {
      const variableName =
        parameter === ''
          ? `${blockType}${localId}`
          : `_TMP_${blockType}${localId}_${parameter}`
      ensureFreshVarSection(state)
      const cpOut = getconnectionPointOut(variable)
      const connType =
        cpOut !== null ? state.connectionTypes.get(cpOut) ?? 'ANY' : 'ANY'
      state.iface[state.iface.length - 1].vars.push({
        type: connType,
        name: variableName,
        address: null,
        initial: null,
      })

      if (outputVariables.length > 1 && parameter !== '' && parameter !== 'OUT') {
        vars.push([
          [parameter, [state.tagName, 'block', localId, 'output', i]],
          [` => ${variableName}`, []],
        ])
      } else {
        outputInfo = [state.tagName, 'block', localId, 'output', i]
        outputName = variableName
      }
    }
  }

  if (outputName === null || outputInfo === null) {
    // Python ends up with this case effectively as "no primary output";
    // the call still emits with a placeholder. The corpus never triggers
    // this since standard functions always have a primary output.
    return
  }

  state.program.push([state.currentIndent, []])
  state.program.push([outputName, outputInfo])
  state.program.push([' := ', []])
  state.program.push([blockType, [state.tagName, 'block', localId, 'type']])
  state.program.push(['(', []])
  state.program.push(...joinChunkLists([[', ', []]], vars))
  state.program.push([');\n', []])
}

/* ──────────────────── function block branch (emit) ─────────────────────── */

function emitFunctionBlockCall(
  state: GenState,
  block: Element,
  blockInfos: BlockInfos,
  body: Element,
  instanceName: string | null,
  localId: number,
  executionOrderId: number,
  inputVariables: Element[],
  inputNames: string[],
  inoutVariables: Map<string, ProgramChunk[]>,
  order: boolean,
): void {
  if (state.computedBlocks.get(block) === true || order) return
  state.computedBlocks.set(block, true)

  const vars: ProgramChunk[][] = []
  let offsetIdx = 0

  for (const variable of inputVariables) {
    const parameter = getformalParameter(variable)
    if (parameter === null) continue
    if (!inputNames.includes(parameter) && parameter !== 'EN') continue

    let inputIdx: number
    if (parameter === 'EN') {
      inputIdx = 0
      offsetIdx = 1
    } else {
      inputIdx = offsetIdx + inputNames.indexOf(parameter)
    }
    const inputInfo: Location = [state.tagName, 'block', localId, 'input', inputIdx]
    const cpIn = getconnectionPointIn(variable)
    const connections = cpIn ? getconnections(cpIn) : []
    if (connections.length === 0) continue

    const expression = computeExpression(
      state,
      body,
      connections,
      executionOrderId > 0,
      inoutVariables.has(parameter),
    )
    if (expression !== null) {
      vars.push([
        [parameter, inputInfo],
        [' := ', []],
        ...extractModifier(state, variable, expression, inputInfo),
      ])
    } else if (inoutVariables.has(parameter)) {
      raiseUnconnectedInOutError(instanceName, blockInfos.name, parameter, state)
    }
  }

  state.program.push([state.currentIndent, []])
  state.program.push([
    instanceName ?? '',
    [state.tagName, 'block', localId, 'name'],
  ])
  state.program.push(['(', []])
  state.program.push(...joinChunkLists([[', ', []]], vars))
  state.program.push([');\n', []])
}

/* ──────────────────── output-side resolution ──────────────────────────── */

function resolveBlockOutput(
  state: GenState,
  block: Element,
  blockInfos: BlockInfos,
  body: Element,
  link: Element | null,
  instanceName: string | null,
  blockType: string,
  localId: number,
  executionOrderId: number,
  inputVariables: Element[],
  outputVariables: Element[],
  outputNames: string[],
  inoutVariables: Map<string, ProgramChunk[]>,
  toInout: boolean,
): ProgramChunk[] | undefined {
  let connectionPoint: { x: number; y: number } | null = null
  let outputParameter: string | null = null

  if (link !== null) {
    const positions = getpositions(link)
    connectionPoint = positions.length > 0 ? positions[positions.length - 1] : null
    outputParameter = getformalParameter(link)
  }

  let outputVariable: Element | null = null
  let outputIdx = 0

  if (outputParameter !== null) {
    if (outputNames.includes(outputParameter) || outputParameter === 'ENO') {
      for (const variable of outputVariables) {
        if (getformalParameter(variable) === outputParameter) {
          outputVariable = variable
          if (outputParameter !== 'ENO') {
            outputIdx = outputNames.indexOf(outputParameter)
          }
          break
        }
      }
    }
  } else {
    // Disambiguate by endpoint-position match against each output port.
    const blockPos = getposition(block)
    for (let i = 0; i < outputVariables.length; i++) {
      const variable = outputVariables[i]
      const cpOut = getconnectionPointOut(variable)
      if (!cpOut) continue
      const rel = getrelPositionXY(cpOut)
      if (!rel) continue
      if (!blockPos) continue
      const matches =
        connectionPoint === null ||
        (blockPos.x + rel[0] === connectionPoint.x &&
          blockPos.y + rel[1] === connectionPoint.y)
      if (matches) {
        outputVariable = variable
        outputParameter = getformalParameter(variable)
        outputIdx = i
        break
      }
    }
  }

  if (outputVariable !== null && outputParameter !== null) {
    if (blockInfos.type === 'function') {
      const outputInfo: Location = [
        state.tagName,
        'block',
        localId,
        'output',
        outputIdx,
      ]
      let outputValue: ProgramChunk[]
      if (inoutVariables.has(outputParameter)) {
        // The "output" is actually an inout — return the input-side expression.
        let inoutExpr: ProgramChunk[] | null = null
        for (const variable of inputVariables) {
          if (getformalParameter(variable) === outputParameter) {
            const cpIn = getconnectionPointIn(variable)
            const connections = cpIn ? getconnections(cpIn) : []
            if (connections.length > 0) {
              inoutExpr = computeExpression(
                state,
                body,
                connections,
                executionOrderId > 0,
                true,
              )
            }
            break
          }
        }
        if (inoutExpr === null) return undefined
        outputValue = inoutExpr
      } else {
        const outName =
          outputParameter === ''
            ? `${blockType}${localId}`
            : `_TMP_${blockType}${localId}_${outputParameter}`
        outputValue = [[outName, outputInfo]]
      }
      return extractModifier(state, outputVariable, outputValue, outputInfo)
    }

    if (blockInfos.type === 'functionBlock') {
      const outputInfo: Location = [
        state.tagName,
        'block',
        localId,
        'output',
        outputIdx,
      ]
      const outputChunks = extractModifier(
        state,
        outputVariable,
        [[`${instanceName ?? ''}.${outputParameter}`, outputInfo]],
        outputInfo,
      )
      if (toInout) {
        const variableName = `${instanceName ?? ''}_${outputParameter}`
        if (!isAlreadyDefinedInIface(state, variableName)) {
          ensureFreshVarSection(state)
          const cpOut = getconnectionPointOut(outputVariable)
          const connType =
            cpOut !== null ? state.connectionTypes.get(cpOut) ?? 'ANY' : 'ANY'
          state.iface[state.iface.length - 1].vars.push({
            type: connType,
            name: variableName,
            address: null,
            initial: null,
          })
          state.program.push([state.currentIndent, []])
          state.program.push([`${variableName} := `, []])
          state.program.push(...outputChunks)
          state.program.push([';\n', []])
        }
        return [[variableName, []]]
      }
      return outputChunks
    }
  }

  if (link !== null) {
    const blockname = instanceName ? `${instanceName}(${blockType})` : blockType
    throw new Error(
      `No output ${outputParameter ?? ''} variable found in block ${blockname} in POU ${state.pou.localName}. Connection must be broken`,
    )
  }
  return undefined
}

/* ──────────────────── shared block-helper utilities ───────────────────── */

function ensureFreshVarSection(state: GenState): void {
  const last = state.iface[state.iface.length - 1]
  if (
    last === undefined ||
    last.keyword !== 'VAR' ||
    last.option !== null ||
    last.located
  ) {
    state.iface.push({ keyword: 'VAR', option: null, located: false, vars: [] })
  }
}

function isAlreadyDefinedInIface(state: GenState, name: string): boolean {
  for (const entry of state.iface) {
    for (const v of entry.vars) {
      if (v.name === name) return true
    }
  }
  return false
}

function raiseUnconnectedInOutError(
  instanceName: string | null,
  blockType: string,
  parameter: string,
  state: GenState,
): never {
  const blockname = instanceName ? `${instanceName}(${blockType})` : blockType
  throw new Error(
    `InOut variable ${parameter} in block ${blockname} in POU ${state.pou.localName} must be connected.`,
  )
}

/* ────────────────────────── small helpers ──────────────────────────────── */

// Re-export so callers can build leaf-only PathNodes easily.
export function leaf(chunks: ProgramChunk[]): PathNode {
  return { kind: 'leaf', chunks }
}
export const TRUE: PathNode = TRUE_NODE

// `getlocalId` re-exported in case test files want it (rare).
export { getlocalId }
