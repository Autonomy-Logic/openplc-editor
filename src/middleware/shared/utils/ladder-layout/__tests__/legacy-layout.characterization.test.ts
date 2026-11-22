/**
 * Today's LD layout, moved into the ladder-layout engine, gives the output recorded from the component functions at
 * the start of the move (`fixtures/legacy/`), and lays every corpus rung out to the geometry the editor saved.
 * @jest-environment node
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CORPUS_PROJECTS,
  type CorpusProjectName,
  ldPouNames,
  loadCorpusProject,
  scenariosAt,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import {
  addNewElement,
  removeElements,
} from '@root/frontend/components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements'
import { createTestStore } from '@root/frontend/store/testing'
import type { HandleBranch, PLCProjectData, RungLadderState } from '@root/middleware/shared/ports/types'
import type { Edge, Node } from '@xyflow/react'

import { legacyLayoutRung, updateDiagramElementsPosition } from '..'

const FIXTURES = join(__dirname, 'fixtures', 'legacy')

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

type EditSpec =
  | { kind: 'remove'; nodeIds: string[] }
  | { kind: 'add'; newNode: { elementType: string; blockVariant?: unknown } }

/** One recorded case: the input, how it was laid out, and today's output with fresh ids normalised. */
interface RecordedCase {
  case: string
  source: string
  entry: 'legacyLayoutRung' | 'updateDiagramElementsPosition' | 'addNewElement' | 'removeElements'
  input: RungLadderState
  expected: Json
  bounds?: [number, number]
  previousNodes?: Node[]
  edit?: EditSpec
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRung(value: unknown): value is RungLadderState {
  return isRecord(value) && typeof value.id === 'string' && Array.isArray(value.nodes) && Array.isArray(value.edges)
}

function isRecordedCase(value: unknown): value is RecordedCase {
  return (
    isRecord(value) &&
    typeof value.case === 'string' &&
    typeof value.source === 'string' &&
    typeof value.entry === 'string' &&
    isRung(value.input) &&
    'expected' in value
  )
}

/** Reads `fixtures/legacy/<name>.json`. */
function readCase(name: string): RecordedCase {
  const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))
  if (!isRecordedCase(parsed)) throw new Error(`fixtures/legacy/${name}.json is not a recorded case`)
  return parsed
}

/** A JSON copy: drops `undefined` members and reads `-0` as `0`, as the recorded files do. */
function toJson(value: unknown): Json {
  const parsed: Json = JSON.parse(JSON.stringify(value))
  return parsed
}

/**
 * Replaces each node id the layout minted (absent from `known`) by `FRESH_<n>`, numbered in output order, everywhere
 * in the result, and sets those nodes' `numericId` to `FRESH`: today's layout builds variable boxes under random ids.
 */
function normalizeFresh(result: { nodes: Node[]; edges: Edge[] }, known: readonly Node[]): Json {
  const knownIds = new Set(known.map((node) => node.id))
  const fresh: string[] = []
  for (const node of result.nodes) if (!knownIds.has(node.id) && !fresh.includes(node.id)) fresh.push(node.id)
  let text = JSON.stringify({ nodes: result.nodes, edges: result.edges })
  fresh.forEach((id, index) => {
    text = text.split(id).join(`FRESH_${index + 1}`)
  })
  const normalized: unknown = JSON.parse(text)
  if (isRecord(normalized) && Array.isArray(normalized.nodes)) {
    for (const node of normalized.nodes) {
      if (isRecord(node) && typeof node.id === 'string' && /^FRESH_\d+$/.test(node.id) && isRecord(node.data)) {
        if ('numericId' in node.data) node.data.numericId = 'FRESH'
      }
    }
  }
  return toJson(normalized)
}

/** Runs a recorded case through the entry point it names. */
function runCase(recorded: RecordedCase): { nodes: Node[]; edges: Edge[] } {
  const input = structuredClone(recorded.input)
  switch (recorded.entry) {
    case 'legacyLayoutRung':
      return legacyLayoutRung(input)
    case 'updateDiagramElementsPosition': {
      if (recorded.bounds === undefined) throw new Error(`${recorded.case} carries no bounds`)
      return updateDiagramElementsPosition(input, recorded.bounds, structuredClone(recorded.previousNodes))
    }
    case 'removeElements': {
      const edit = recorded.edit
      if (edit?.kind !== 'remove') throw new Error(`${recorded.case} carries no remove edit`)
      return removeElements(
        input,
        input.nodes.filter((node) => edit.nodeIds.includes(node.id)),
      )
    }
    case 'addNewElement': {
      const edit = recorded.edit
      if (edit?.kind !== 'add') throw new Error(`${recorded.case} carries no add edit`)
      return addNewElement(input, edit.newNode)
    }
    default: {
      const never: never = recorded.entry
      throw new Error(`unknown entry ${String(never)}`)
    }
  }
}

/** The nodes whose ids count as known: the input's, plus `previousNodes` (identities the layout may reuse). */
function knownNodes(recorded: RecordedCase): Node[] {
  return [...recorded.input.nodes, ...(recorded.previousNodes ?? [])]
}

describe('legacyLayoutRung gives the output recorded from today’s layout', () => {
  const cases: readonly string[] = [
    'series',
    'nested-parallels',
    'parallel-coils',
    'block-en-eno-pin-variables',
    'ctud-handle-branches',
    'in-out-pins',
    'variable-blocks',
    'large-fb',
    'cannot-walk',
    'empty-rung',
    'unusable-bounds',
  ]
  for (const name of cases) {
    it(name, () => {
      const recorded = readCase(name)
      expect(recorded.entry).toBe('legacyLayoutRung')
      expect(normalizeFresh(runCase(recorded), knownNodes(recorded))).toEqual(recorded.expected)
    })
  }

  it('sizes an unsized block from its variant before laying it out', () => {
    const recorded = readCase('large-fb')
    expect(recorded.input.nodes.find((node) => node.type === 'block')?.width).toBeUndefined()
    const block = runCase(recorded).nodes.find((node) => node.type === 'block')
    expect({ width: block?.width, measuredWidth: block?.measured?.width }).toEqual({ width: 216, measuredWidth: 216 })
  })

  it('throws, as today, on a contact that carries no handle data', () => {
    const series = readCase('series').input
    const bare = series.nodes.map((node) =>
      node.type === 'contact' ? { ...node, data: { variant: 'default' } } : node,
    )
    expect(typeof legacyLayoutRung).toBe('function')
    expect(() => legacyLayoutRung({ ...series, nodes: bare })).toThrow(TypeError)
  })
})

describe('updateDiagramElementsPosition, moved under its own name', () => {
  it('reuses the ids of variable boxes passed as previousNodes and lays out within the bounds given', () => {
    const recorded = readCase('helper-previous-nodes')
    expect(recorded.entry).toBe('updateDiagramElementsPosition')
    expect(normalizeFresh(runCase(recorded), knownNodes(recorded))).toEqual(recorded.expected)
  })
})

describe('editing functions lay out through the engine as today (AC11)', () => {
  for (const name of ['edit-delete-coil', 'edit-add-contact', 'edit-add-parallel', 'edit-add-ton']) {
    it(name, () => {
      const recorded = readCase(name)
      expect(normalizeFresh(runCase(recorded), knownNodes(recorded))).toEqual(recorded.expected)
    })
  }
})

/** Handle fields that place a pin: everything a handle carries except what the layout never writes. */
function handleGeometry(handle: unknown): Json {
  if (!isRecord(handle)) return null
  return toJson({
    id: handle.id,
    position: handle.position,
    glbPosition: handle.glbPosition,
    relPosition: handle.relPosition,
    style: handle.style,
  })
}

/** A variable box's identity: the block pin it is attached to (its own id is minted by the layout). */
function variableKey(node: Node): string {
  const data: Record<string, unknown> = node.data
  const block = isRecord(data.block) ? data.block : {}
  return `variable@${String(block.id)}::${String(block.handleId)}::${String(data.variant)}`
}

/**
 * The geometry of a laid-out rung, in array order: each node's position, size and handle positions, and each edge's
 * ends and handles. Variable boxes are named by the pin they hang on.
 */
function geometry(result: { nodes: readonly Node[]; edges: readonly Edge[] }): Json {
  const keys = new Map<string, string>()
  for (const node of result.nodes) keys.set(node.id, node.type === 'variable' ? variableKey(node) : node.id)
  const rename = (id: string): string => {
    let renamed = id
    for (const [from, to] of keys) if (from !== to) renamed = renamed.split(from).join(to)
    return renamed
  }
  const handles = (value: unknown): Json => (Array.isArray(value) ? value.map(handleGeometry) : null)
  return toJson({
    nodes: result.nodes.map((node) => {
      const data: Record<string, unknown> = node.data
      return {
        key: keys.get(node.id),
        type: node.type,
        position: node.position,
        width: node.width,
        height: node.height,
        measured: node.measured,
        handles: handles(data.handles),
        inputHandles: handles(data.inputHandles),
        outputHandles: handles(data.outputHandles),
        inputConnector: handleGeometry(data.inputConnector),
        outputConnector: handleGeometry(data.outputConnector),
        parallelInputConnector: handleGeometry(data.parallelInputConnector),
        parallelOutputConnector: handleGeometry(data.parallelOutputConnector),
      }
    }),
    edges: result.edges.map((edge) => ({
      id: rename(edge.id),
      source: rename(edge.source),
      target: rename(edge.target),
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  })
}

/** The saved rungs of an LD POU, as the project file holds them. */
function savedRungs(data: PLCProjectData, pouName: string): RungLadderState[] {
  const pou = data.pous.find((candidate) => candidate.name === pouName)
  const value = pou?.body.value
  if (!isRecord(value) || !Array.isArray(value.rungs)) throw new Error(`no LD body for POU "${pouName}"`)
  return value.rungs.filter(isRung)
}

/** The handle branches the store derives when it loads the POU (they are not saved in the file). */
function loadedHandleBranches(pouName: string, rungs: RungLadderState[]): (HandleBranch[] | undefined)[] {
  const store = createTestStore()
  store.getState().ladderFlowActions.addLadderFlow({ name: pouName, updated: false, rungs: structuredClone(rungs) })
  const flow = store.getState().ladderFlows.find((candidate) => candidate.name === pouName)
  return (flow?.rungs ?? []).map((rung) => rung.handleBranches)
}

/** Moves every element except the rails to the origin, as a rung written without coordinates arrives. */
function clearElementPositions(rung: RungLadderState): RungLadderState {
  return {
    ...rung,
    nodes: rung.nodes.map((node) => (node.type === 'powerRail' ? node : { ...node, position: { x: 0, y: 0 } })),
  }
}

/**
 * Today's layout output for the corpus rungs whose saved geometry it does not reproduce (copied from an e2e fixture
 * and saved unchanged), from `fixtures/legacy/corpus-recorded.json`; the other rungs compare with their saved geometry.
 */
function recordedCorpusGeometry(): Record<string, Json> {
  const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES, 'corpus-recorded.json'), 'utf8'))
  if (!isRecord(parsed) || !isRecord(parsed.rungs)) throw new Error('fixtures/legacy/corpus-recorded.json is malformed')
  return toJsonRecord(parsed.rungs)
}

function toJsonRecord(value: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const [key, entry] of Object.entries(value)) out[key] = toJson(entry)
  return out
}

describe('the corpus, laid out through the moved code, keeps the geometry today’s editor saved', () => {
  const recorded = recordedCorpusGeometry()
  for (const project of CORPUS_PROJECTS) {
    const data = loadCorpusProject(project)
    for (const pou of ldPouNames(data)) {
      const rungs = savedRungs(data, pou)
      const branches = loadedHandleBranches(pou, rungs)
      rungs.forEach((saved, index) => {
        const name = rungName(project, pou, index + 1)
        const rung: RungLadderState = { ...structuredClone(saved), selectedNodes: [], handleBranches: branches[index] }
        const expected = (variant: 'as-saved' | 'cleared'): Json =>
          recorded[`${project}/${pou}/rung ${index + 1}/${variant}`] ?? geometry(saved)

        it(`${name} as saved`, () => {
          expect(geometry(legacyLayoutRung(structuredClone(rung)))).toEqual(expected('as-saved'))
        })

        it(`${name} from cleared element positions`, () => {
          expect(geometry(legacyLayoutRung(clearElementPositions(structuredClone(rung))))).toEqual(expected('cleared'))
        })
      })
    }
  }
})

/** `<project>/<POU>/rung <n> [<scenario ids>]`, as the corpus test names its rungs. */
function rungName(project: CorpusProjectName, pou: string, rung: number): string {
  return `${project}/${pou}/rung ${rung} [${scenariosAt(project, pou, rung)
    .map((scenario) => scenario.id)
    .join(' ')}]`
}
