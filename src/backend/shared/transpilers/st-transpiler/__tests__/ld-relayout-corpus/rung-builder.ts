import type { PLCProjectData, PLCVariable, RungLadderState } from '@root/middleware/shared/ports/types'
import type { LadderLabelSource } from '@root/middleware/shared/utils/ladder-layout'
import type { Edge, Node } from '@xyflow/react'

import { loadCorpusProject } from './corpus'
import { savedRungs } from './relayout'

/** One element of a synthetic series rung, left to right between the rails. */
export type SeriesElement =
  | { kind: 'contact'; id: string; name: string }
  | { kind: 'coil'; id: string; name: string }
  | {
      kind: 'block'
      id: string
      template: BlockTemplateName
      instance: string
      /** Pin variable or literal per secondary pin, e.g. `{ PT: 'T#5s', ET: 'Elapsed' }`. */
      pins?: Readonly<Record<string, string>>
      /** Replaces the block type name (`data.variant.name`), for a user block with a long type name. */
      typeName?: string
    }
  | {
      kind: 'parallel'
      id: string
      /** Two or more branches, top to bottom; a third or later branch is stacked as the editor builds it. */
      branches: readonly (readonly SeriesElement[])[]
    }

/** Library blocks the builder can place: TON (IN, PT / Q, ET) and CTU (CU, R, PV / Q, CV). */
export type BlockTemplateName = 'TON' | 'CTU'

interface Template {
  nodes: Node[]
  edges: Edge[]
}

interface Templates {
  leftRail: Node
  rightRail: Node
  contact: Node
  coil: Node
  open: Node
  close: Node
  blocks: Readonly<Record<BlockTemplateName, Template & { block: Node }>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function dataOf(node: Node): Record<string, unknown> {
  return node.data
}

function nodeOfType(rung: RungLadderState, type: string, variant?: string): Node {
  const found = rung.nodes.find(
    (node) => node.type === type && (variant === undefined || dataOf(node).variant === variant),
  )
  if (found === undefined) throw new Error(`rung ${rung.id} has no ${type} ${variant ?? ''}`)
  return found
}

/** A block of a saved rung with its pin variable boxes and the edges between them. */
function blockTemplate(rung: RungLadderState, typeName: BlockTemplateName): Template & { block: Node } {
  const block = rung.nodes.find((node) => {
    const variant = dataOf(node).variant
    return node.type === 'block' && isRecord(variant) && variant.name === typeName
  })
  if (block === undefined) throw new Error(`rung ${rung.id} has no ${typeName} block`)
  const boxes = rung.nodes.filter((node) => {
    const owner = dataOf(node).block
    return node.type === 'variable' && isRecord(owner) && owner.id === block.id
  })
  const ids = new Set([block.id, ...boxes.map((node) => node.id)])
  const edges = rung.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
  return { block, nodes: [block, ...boxes], edges }
}

/** B10 rung 3: a two-branch parallel group of contacts. */
function ctuRungParallel(data: PLCProjectData): RungLadderState {
  return savedRungs(data, 'Auxiliary')[2]
}

function parallelNode(rung: RungLadderState, type: 'open' | 'close'): Node {
  const found = rung.nodes.find((node) => node.type === 'parallel' && dataOf(node).type === type)
  if (found === undefined) throw new Error(`rung ${rung.id} has no ${type} parallel node`)
  return found
}

let cached: Templates | undefined

/** Editor-built nodes taken from the corpus: B01 for rails, contact and coil, B08 for TON, B10 rung 2 for CTU. */
function templates(): Templates {
  if (cached !== undefined) return cached
  const basic = loadCorpusProject('ld-corpus-basic')
  const [b01] = savedRungs(basic, 'Main')
  const b08 = savedRungs(basic, 'Blocks')[3]
  const ctuRung = savedRungs(basic, 'Auxiliary')[1]
  cached = {
    leftRail: nodeOfType(b01, 'powerRail', 'left'),
    rightRail: nodeOfType(b01, 'powerRail', 'right'),
    contact: nodeOfType(b01, 'contact'),
    coil: nodeOfType(b01, 'coil'),
    open: parallelNode(ctuRungParallel(basic), 'open'),
    close: parallelNode(ctuRungParallel(basic), 'close'),
    blocks: { TON: blockTemplate(b08, 'TON'), CTU: blockTemplate(ctuRung, 'CTU') },
  }
  return cached
}

/** A deep copy of `value` with every whole occurrence of each `from` id replaced by its `to` id. */
function renameIds<T>(value: T, ids: ReadonlyMap<string, string>): T {
  let text = JSON.stringify(value)
  for (const [from, to] of ids) text = text.split(JSON.stringify(from)).join(JSON.stringify(to))
  const parsed: T = JSON.parse(text)
  return parsed
}

function edge(source: string, sourceHandle: string, target: string, targetHandle: string): Edge {
  return { id: `e_${source}_${target}__${sourceHandle}_${targetHandle}`, source, target, sourceHandle, targetHandle }
}

function handleId(node: Node, key: 'inputConnector' | 'outputConnector'): string {
  const connector = dataOf(node)[key]
  if (!isRecord(connector) || typeof connector.id !== 'string') throw new Error(`node ${node.id} has no ${key}`)
  return connector.id
}

let numericId = 9000000

/** A copy of a contact or coil template named `name`, under id `id`, at `x`. */
function simpleNode(template: Node, id: string, name: string, x: number, y = 38): Node {
  const data = structuredClone(dataOf(template))
  const variable = isRecord(data.variable) ? data.variable : {}
  return {
    ...structuredClone(template),
    id,
    position: { x, y },
    data: { ...data, numericId: String((numericId += 1)), variable: { ...variable, id: `${id}-var`, name } },
  }
}

/** A copy of a block template with its pin boxes: ids `<id>` and `<id>:<pin>`, names and pins as given. */
function blockNodes(
  element: Extract<SeriesElement, { kind: 'block' }>,
  x: number,
  dy: number,
): Template & { block: Node } {
  const template = templates().blocks[element.template]
  const ids = new Map<string, string>([[template.block.id, element.id]])
  for (const node of template.nodes.slice(1)) {
    const owner = dataOf(node).block
    const pin = isRecord(owner) && typeof owner.handleId === 'string' ? owner.handleId : node.id
    ids.set(node.id, `${element.id}:${pin}`)
  }
  const dx = x - template.block.position.x
  const pins = element.pins ?? {}
  const nodes = renameIds(template.nodes, ids).map((node) => {
    const data = dataOf(node)
    const moved = { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } }
    if (node.id === element.id) {
      const variant = isRecord(data.variant) ? data.variant : {}
      const connected = Array.isArray(data.connectedVariables) ? data.connectedVariables : []
      return {
        ...moved,
        data: {
          ...data,
          numericId: String((numericId += 1)),
          variable: {
            ...(isRecord(data.variable) ? data.variable : {}),
            id: `${element.id}-var`,
            name: element.instance,
          },
          variant: { ...variant, name: element.typeName ?? variant.name },
          connectedVariables: connected.map((entry: unknown) =>
            isRecord(entry) && typeof entry.handleId === 'string' && entry.handleId in pins
              ? { ...entry, variable: { name: pins[entry.handleId] } }
              : entry,
          ),
        },
      }
    }
    const owner = isRecord(data.block) ? data.block : {}
    const pin = typeof owner.handleId === 'string' ? owner.handleId : ''
    const name = pins[pin]
    return {
      ...moved,
      data: {
        ...data,
        numericId: String((numericId += 1)),
        ...(name === undefined ? {} : { variable: { name } }),
      },
    }
  })
  const block = nodes[0]
  const edges = renameIds(template.edges, ids).map((wire) =>
    edge(wire.source, wire.sourceHandle ?? '', wire.target, wire.targetHandle ?? ''),
  )
  return { block, nodes, edges }
}

/** The opening or closing parallel node of a stacked pair, under id `id`, pointing at its partner. */
function pairNode(type: 'open' | 'close', id: string, partner: string, x: number, y: number): Node {
  const template = type === 'open' ? templates().open : templates().close
  const data = structuredClone(dataOf(template))
  delete data.parallelOpenReference
  delete data.parallelCloseReference
  const reference = type === 'open' ? { parallelCloseReference: partner } : { parallelOpenReference: partner }
  return {
    ...structuredClone(template),
    id,
    position: { x, y },
    data: { ...data, ...reference, numericId: String((numericId += 1)) },
  }
}

/** Where a wire ends or starts on a node: its id and handle. */
interface End {
  id: string
  handle: string
}

/** Collects the nodes and edges of a rung while elements are placed left to right. */
class RungDraft {
  readonly main: Node[] = []
  readonly boxes: Node[] = []
  readonly edges: Edge[] = []
  x = 60

  /** Places `elements` in series from `from` at wire y `y`; returns the end the next element connects to. */
  series(elements: readonly SeriesElement[], from: End, y: number, entry?: string): End {
    let previous = from
    let target = entry
    for (const element of elements) {
      previous = this.element(element, previous, y, target)
      target = undefined
    }
    return previous
  }

  /** Places one element after `from`; `entry` overrides the target handle of the incoming wire. */
  private element(element: SeriesElement, from: End, y: number, entry?: string): End {
    const x = (this.x += 120)
    switch (element.kind) {
      case 'contact':
      case 'coil': {
        const t = templates()
        this.main.push(simpleNode(element.kind === 'contact' ? t.contact : t.coil, element.id, element.name, x, y))
        this.edges.push(edge(from.id, from.handle, element.id, entry ?? 'input'))
        return { id: element.id, handle: 'output' }
      }
      case 'block': {
        const built = blockNodes(element, x, y - 38)
        this.main.push(built.block)
        this.boxes.push(...built.nodes.slice(1))
        this.edges.push(edge(from.id, from.handle, element.id, handleId(built.block, 'inputConnector')), ...built.edges)
        return { id: element.id, handle: handleId(built.block, 'outputConnector') }
      }
      case 'parallel':
        if (element.branches.length < 2) throw new Error(`parallel ${element.id} needs two branches`)
        return this.pair(element, 0, from, y, entry ?? 'input')
      default: {
        const never: never = element
        throw new Error(`unknown element ${JSON.stringify(never)}`)
      }
    }
  }

  /** One open/close pair of a group: branch `k` on top, the last branch or the next pair below. */
  private pair(
    group: Extract<SeriesElement, { kind: 'parallel' }>,
    k: number,
    from: End,
    y: number,
    entry: string,
  ): End {
    const openId = `${group.id}:open${k}`
    const closeId = `${group.id}:close${k}`
    const open = pairNode('open', openId, closeId, this.x, y + 11)
    this.main.push(open)
    this.edges.push(edge(from.id, from.handle, openId, entry))
    const top = this.series(group.branches[k], { id: openId, handle: 'output-right' }, y)
    const belowY = y + 92 * (1 + Math.max(0, group.branches[k].filter((each) => each.kind === 'parallel').length))
    const below =
      k === group.branches.length - 2
        ? this.series(group.branches[k + 1], { id: openId, handle: 'output-down' }, belowY)
        : this.pair(group, k + 1, { id: openId, handle: 'output-down' }, belowY, 'input-top')
    const close = pairNode('close', closeId, openId, (this.x += 60), y + 11)
    this.main.push(close)
    this.edges.push(edge(top.id, top.handle, closeId, 'input'))
    const lastBelow = k === group.branches.length - 2 ? below : { id: below.id, handle: 'output-top' }
    this.edges.push(edge(lastBelow.id, lastBelow.handle, closeId, 'input-down'))
    return { id: closeId, handle: 'output-right' }
  }
}

/**
 * An editor-shaped rung holding `elements` in series between its rails, built from editor-saved nodes of the corpus;
 * a parallel element becomes the open/close pairs the editor saves. Node order: left rail, the elements in placing
 * order, right rail, then the pin variable boxes.
 */
export function seriesRung(rungId: string, elements: readonly SeriesElement[]): RungLadderState {
  const t = templates()
  const leftId = `left-rail-${rungId}`
  const rightId = `right-rail-${rungId}`
  const draft = new RungDraft()
  const last = draft.series(elements, { id: leftId, handle: 'left-rail' }, 38)
  draft.edges.push(edge(last.id, last.handle, rightId, 'right-rail'))
  const width = draft.x + 120
  const leftRail = { ...renameIds(t.leftRail, new Map([[t.leftRail.id, leftId]])), position: { x: 0, y: 30 } }
  const rightRail = { ...renameIds(t.rightRail, new Map([[t.rightRail.id, rightId]])), position: { x: width, y: 30 } }
  return {
    id: rungId,
    comment: '',
    defaultBounds: [300, 100],
    reactFlowViewport: [width + 3, 200],
    selectedNodes: [],
    nodes: [leftRail, ...draft.main, rightRail, ...draft.boxes],
    edges: draft.edges,
  }
}

/** A copy of a saved rung with contacts, coils, blocks and pin boxes renamed: `names` maps old variable names to new. */
export function renamedRung(rung: RungLadderState, names: Readonly<Record<string, string>>): RungLadderState {
  const copy = structuredClone(rung)
  for (const node of copy.nodes) {
    const data = dataOf(node)
    const variable = data.variable
    if (isRecord(variable) && typeof variable.name === 'string' && variable.name in names) {
      data.variable = { ...variable, name: names[variable.name] }
    }
    const connected = data.connectedVariables
    if (Array.isArray(connected)) {
      data.connectedVariables = connected.map((entry: unknown) => {
        if (!isRecord(entry) || !isRecord(entry.variable)) return entry
        const name = entry.variable.name
        return typeof name === 'string' && name in names
          ? { ...entry, variable: { ...entry.variable, name: names[name] } }
          : entry
      })
    }
  }
  return copy
}

/** A BOOL program variable, local unless `variableClass` says otherwise. */
export function boolVariable(name: string, location = '', variableClass: PLCVariable['class'] = 'local'): PLCVariable {
  return { name, class: variableClass, type: { definition: 'base-type', value: 'BOOL' }, location, documentation: '' }
}

/** A label source from POU variables and resource globals. */
export function labelSource(
  pouVariables: readonly PLCVariable[],
  globalVariables: readonly PLCVariable[] = [],
): LadderLabelSource {
  return { pouVariables, globalVariables }
}

/** A deterministic generator of numbers in [0, 1) (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_0123456789'
const WIDE_CHARS = 'ポンプ起動停止弁温度'

/** A name of 1 to `maxLength` characters; about one in five carries East Asian wide characters. */
export function randomName(random: () => number, maxLength: number): string {
  const length = 1 + Math.floor(random() * maxLength)
  const wide = random() < 0.2
  let name = 'v'
  for (let index = 1; index < length; index++) {
    const pool = wide && random() < 0.5 ? WIDE_CHARS : NAME_CHARS
    name += pool[Math.floor(random() * pool.length)]
  }
  return name
}

/** A location: none, a literal `%` address of any width, or an alias name of up to 40 characters. */
export function randomLocation(random: () => number): string {
  const pick = random()
  if (pick < 0.25) return ''
  const a = Math.floor(random() * 1000)
  const b = Math.floor(random() * 8)
  if (pick < 0.45) return `%IX${a}.${b}`
  if (pick < 0.6) return `%QX${a}.${b}`
  if (pick < 0.75) return `%IW${a}`
  return randomName(random, 40)
}

/** The project's label source for `pouName` with every POU variable and global given a generated location. */
export function generatedLabelSource(data: PLCProjectData, pouName: string, seed: number): LadderLabelSource {
  const random = seededRandom(seed)
  const pou = data.pous.find((candidate) => candidate.name === pouName)
  const relocate = (variable: PLCVariable): PLCVariable => ({ ...variable, location: randomLocation(random) })
  return {
    pouVariables: (pou?.interface?.variables ?? []).map(relocate),
    globalVariables: data.configurations.resource.globalVariables.map(relocate),
  }
}

/** A generated series rung (contacts, coils, TON and CTU with bound pins) and a label source locating its names. */
export function generatedSeriesRung(seed: number): { rung: RungLadderState; src: LadderLabelSource } {
  const random = seededRandom(seed)
  const count = 1 + Math.floor(random() * 7)
  const names: string[] = []
  const named = (): string => {
    const name = `${randomName(random, 30)}_${names.length}`
    names.push(name)
    return name
  }
  const elements: SeriesElement[] = []
  for (let index = 0; index < count; index++) {
    const id = `g${seed}_${index}`
    const pick = random()
    if (pick < 0.4) elements.push({ kind: 'contact', id, name: named() })
    else if (pick < 0.7) elements.push({ kind: 'coil', id, name: named() })
    else if (pick < 0.85)
      elements.push({ kind: 'block', id, template: 'TON', instance: named(), pins: { PT: named(), ET: named() } })
    else
      elements.push({
        kind: 'block',
        id,
        template: 'CTU',
        instance: named(),
        pins: { R: named(), PV: named(), CV: named() },
      })
  }
  const variables = names.map((name) => boolVariable(name, randomLocation(random)))
  return { rung: seriesRung(`rung_gen_${seed}`, elements), src: labelSource(variables) }
}
