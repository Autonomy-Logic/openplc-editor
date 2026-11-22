import { emitLdBody } from '@root/backend/shared/transpilers/st-transpiler/walker/ld'
import type { RFEdge, RFNode } from '@root/backend/shared/transpilers/st-transpiler/walker/types'
import type { Edge, Node } from '@xyflow/react'

import type { BasicNodeData, PlaceholderNode } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import type { OpenPLCStore } from '../../../../../../../../store'
import type { RungLadderState } from '../../../../../../../../store/slices/ladder'
import { createTestStore } from '../../../../../../../../store/testing'
import { addNewElement } from '..'
import { renderPlaceholderElements } from '../placeholder'

const POU = 'main_ld'
const RUNG = 'rung-1'

let store: OpenPLCStore

type Marker = (placeholder: PlaceholderNode) => boolean

const libraryVariant = (name: string) => {
  const pou = store
    .getState()
    .libraries.system.flatMap((library) => library.pous)
    .find((candidate) => candidate.name === name)
  if (!pou) throw new Error(`system library has no ${name}`)
  return {
    name: pou.name,
    type: pou.type,
    variables: pou.variables,
    documentation: pou.documentation,
    extensible: false,
  }
}

const rung = (): RungLadderState => {
  const found = store
    .getState()
    .ladderFlows.find((flow) => flow.name === POU)
    ?.rungs.find((candidate) => candidate.id === RUNG)
  if (!found) throw new Error(`no rung ${RUNG}`)
  return found
}

const nodeNamed = (name: string): Node => {
  const found = rung().nodes.find((node) => (node.data as BasicNodeData).variable?.name === name)
  if (!found) throw new Error(`no node named ${name}`)
  return found
}

const related =
  (name: string, position: 'left' | 'right' | 'bottom'): Marker =>
  (placeholder) =>
    placeholder.data.position === position &&
    (placeholder.data.relatedNode?.data as BasicNodeData | undefined)?.variable?.name === name

const leftRail: Marker = (placeholder) => placeholder.data.relatedNode?.id.startsWith('left-rail') ?? false

const pinOf =
  (blockName: string, pin: string): Marker =>
  (placeholder) =>
    placeholder.id === `placeholder_handle_${nodeNamed(blockName).id}_${pin}`

/** Drops one library element on the marker `marker` selects, as the editor's drop path does, and names it. */
const drop = (marker: Marker, element: { elementType: string; blockVariant?: object }, name: string) => {
  const current = rung()
  const withPlaceholders = renderPlaceholderElements(current)
  const target = withPlaceholders.find(
    (node) => (node.type === 'placeholder' || node.type === 'parallelPlaceholder') && marker(node as PlaceholderNode),
  )
  if (!target) throw new Error(`no marker for ${name}`)
  const { nodes, edges, newNode, handleBranches } = addNewElement(
    { ...current, nodes: withPlaceholders.map((node) => ({ ...node, selected: node.id === target.id })) },
    element,
  )
  if (!newNode) throw new Error(`${name} was not placed`)
  const actions = store.getState().ladderFlowActions
  actions.setNodes({
    editorName: POU,
    rungId: RUNG,
    nodes: nodes.map((node) =>
      node.id === newNode.id ? { ...node, data: { ...node.data, variable: { name } } } : node,
    ),
  })
  actions.setEdges({ editorName: POU, rungId: RUNG, edges })
  if (handleBranches) actions.setHandleBranches({ editorName: POU, rungId: RUNG, handleBranches })
}

const contact = { elementType: 'contact' }
const coil = { elementType: 'coil' }

const st = (): string => {
  const current = rung()
  const nodes: RFNode[] = current.nodes.map((node: Node) => ({
    id: node.id,
    type: node.type ?? '',
    position: node.position,
    data: node.data,
  }))
  const edges: RFEdge[] = current.edges.map((edge: Edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  }))
  return emitLdBody({ rungs: [{ nodes, edges, reactFlowViewport: current.reactFlowViewport }] }).bodySt
}

/** Names of the elements wired downstream of the node named `name`, rails excluded. */
const downstreamNames = (name: string): string[] => {
  const { nodes, edges } = rung()
  const seen = new Set<string>()
  const queue = [nodeNamed(name).id]
  while (queue.length > 0) {
    const id = queue.shift() ?? ''
    for (const edge of edges.filter((candidate) => candidate.source === id)) {
      if (seen.has(edge.target)) continue
      seen.add(edge.target)
      queue.push(edge.target)
    }
  }
  return nodes
    .filter((node) => seen.has(node.id) && node.type !== 'powerRail' && node.type !== 'parallel')
    .map((node) => (node.data as BasicNodeData).variable?.name ?? node.id)
}

/** The expression the generated ST passes to `pin`, e.g. `k OR j AND i` from `CTUD0(CU := a, LD := k OR j AND i);`. */
const pinExpression = (pin: string): string => {
  const text = st()
  const match = new RegExp(`\\b${pin} := `).exec(text)
  if (!match) throw new Error(`no ${pin} argument in:\n${text}`)
  let depth = 0
  let end = match.index + match[0].length
  for (; end < text.length; end++) {
    const char = text[end]
    if (char === '(') depth++
    else if (char === ')' && depth-- === 0) break
    else if (char === ',' && depth === 0) break
  }
  return text.slice(match.index + match[0].length, end).trim()
}

/** Evaluates an ST boolean expression of AND, OR and parentheses over the given contact values. */
const evaluate = (expression: string, values: Record<string, boolean>): boolean => {
  const tokens = expression.match(/\(|\)|[A-Za-z_]\w*/g) ?? []
  let at = 0
  const primary = (): boolean => {
    const token = tokens[at++]
    if (token === '(') {
      const value = or()
      if (tokens[at++] !== ')') throw new Error(`unbalanced parentheses in ${expression}`)
      return value
    }
    if (!(token in values)) throw new Error(`unexpected ${token} in ${expression}`)
    return values[token]
  }
  const and = (): boolean => {
    let value = primary()
    while (tokens[at] === 'AND') {
      at++
      value = primary() && value
    }
    return value
  }
  const or = (): boolean => {
    let value = and()
    while (tokens[at] === 'OR') {
      at++
      value = and() || value
    }
    return value
  }
  const result = or()
  if (at !== tokens.length) throw new Error(`trailing tokens in ${expression}`)
  return result
}

/** Asserts the pin's expression has the same truth table as `expected` over `contacts`. */
const expectPinLogic = (pin: string, contacts: string[], expected: (v: Record<string, boolean>) => boolean) => {
  const expression = pinExpression(pin)
  for (let mask = 0; mask < 1 << contacts.length; mask++) {
    const values = Object.fromEntries(contacts.map((name, bit) => [name, (mask & (1 << bit)) !== 0]))
    expect({ expression, values, result: evaluate(expression, values) }).toEqual({
      expression,
      values,
      result: expected(values),
    })
  }
}

/** Steps 1-3 of the H02 network: a -> block -> qu. */
const blockRung = (blockType: string, instance: string) => {
  drop(leftRail, contact, 'a')
  drop(related('a', 'right'), { elementType: 'block', blockVariant: libraryVariant(blockType) }, instance)
  drop(related(instance, 'right'), coil, 'qu')
}

/** Steps 4-6 of the H02 network: i on the pin, k in parallel below i, j right of i. */
const h02Start = () => {
  blockRung('CTUD', 'CTUD0')
  drop(pinOf('CTUD0', 'LD'), contact, 'i')
  drop(related('i', 'bottom'), contact, 'k')
  drop(related('i', 'right'), contact, 'j')
}

describe('Ladder: contacts added on the parallel path of a block pin branch', () => {
  beforeEach(() => {
    store = createTestStore()
    expect(store.getState().pouActions.create({ type: 'program', name: POU, language: 'ld' }).ok).toBe(true)
    store.getState().ladderFlowActions.startLadderRung({ editorName: POU, rungId: RUNG, defaultBounds: [1500, 200] })
  })

  it('builds (i AND j) OR k on CTUD.LD (H02 steps 1-6)', () => {
    h02Start()

    expect(downstreamNames('qu')).toEqual([])
    expectPinLogic('LD', ['i', 'j', 'k'], (v) => (v.i && v.j) || v.k)
  })

  it('wires l in series with k, never after the coil (H02 step 7)', () => {
    h02Start()
    drop(related('k', 'right'), contact, 'l')

    expect(downstreamNames('qu')).toEqual([])
    expectPinLogic('LD', ['i', 'j', 'k', 'l'], (v) => (v.i && v.j) || (v.k && v.l))
    expect(nodeNamed('l').position.y).toBe(nodeNamed('k').position.y)
    expect(nodeNamed('l').position.x).toBeGreaterThan(nodeNamed('k').position.x)
    expect(nodeNamed('l').position.x).toBeLessThan(nodeNamed('CTUD0').position.x)
  })

  it('places m in parallel with l on the lower leg (H02 step 8)', () => {
    h02Start()
    drop(related('k', 'right'), contact, 'l')
    drop(related('l', 'bottom'), contact, 'm')

    expect(downstreamNames('qu')).toEqual([])
    expectPinLogic('LD', ['i', 'j', 'k', 'l', 'm'], (v) => (v.i && v.j) || (v.k && (v.l || v.m)))
    expect(nodeNamed('m').position.x).toBe(nodeNamed('l').position.x)
    expect(nodeNamed('m').position.y).toBeGreaterThan(nodeNamed('l').position.y)
  })

  it('wires l in series with k without j', () => {
    blockRung('CTUD', 'CTUD0')
    drop(pinOf('CTUD0', 'LD'), contact, 'i')
    drop(related('i', 'bottom'), contact, 'k')
    drop(related('k', 'right'), contact, 'l')

    expect(downstreamNames('qu')).toEqual([])
    expectPinLogic('LD', ['i', 'k', 'l'], (v) => v.i || (v.k && v.l))
  })

  it('wires l before k without j', () => {
    blockRung('CTUD', 'CTUD0')
    drop(pinOf('CTUD0', 'LD'), contact, 'i')
    drop(related('i', 'bottom'), contact, 'k')
    drop(related('k', 'left'), contact, 'l')

    expect(downstreamNames('qu')).toEqual([])
    expectPinLogic('LD', ['i', 'k', 'l'], (v) => v.i || (v.k && v.l))
  })

  it('wires l in series with k on CTU.R', () => {
    blockRung('CTU', 'CTU0')
    drop(pinOf('CTU0', 'R'), contact, 'i')
    drop(related('i', 'bottom'), contact, 'k')
    drop(related('k', 'right'), contact, 'l')

    expect(downstreamNames('qu')).toEqual([])
    expectPinLogic('R', ['i', 'k', 'l'], (v) => v.i || (v.k && v.l))
  })
})
