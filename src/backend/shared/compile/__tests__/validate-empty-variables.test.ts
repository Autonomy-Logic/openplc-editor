/**
 * Tests for the pre-compile blank-FBD-variable guard.
 *
 * An unnamed FBD input/output variable block becomes an empty
 * `<expression/>` in the PLCopen XML, which crashes xml2st with
 * `'NoneType' object has no attribute 'split'`.  These tests pin the
 * detector that lets the pipeline bail with a clear message — naming
 * what the block is wired to, or its position when it is wired to
 * nothing.
 */

import type { PLCProjectData } from '../../types/PLC/open-plc'
import { findEmptyFbdVariables } from '../steps/validate-empty-variables'

type TestNode = {
  id: string
  type: string
  position: { x: number; y: number }
  draggable: boolean
  selectable: boolean
  data: unknown
}

type TestEdge = { id: string; source: string; sourceHandle: string; target: string; targetHandle: string }

function makeNode(id: string, type: string, data: unknown, x = 0, y = 0): TestNode {
  return { id, type, position: { x, y }, draggable: true, selectable: true, data }
}

function varNode(id: string, type: string, name: string | undefined, x = 0, y = 0): TestNode {
  return makeNode(id, type, name === undefined ? {} : { variable: { name } }, x, y)
}

function makeFbdPou(name: string, nodes: TestNode[], edges: TestEdge[] = []) {
  return {
    type: 'program',
    data: {
      name,
      language: 'fbd',
      variables: [],
      documentation: '',
      body: { language: 'fbd', value: { name, rung: { comment: '', nodes, edges } } },
    },
  }
}

function makeProject(pous: unknown[]): PLCProjectData {
  return {
    pous,
    dataTypes: [],
    configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
  } as unknown as PLCProjectData
}

describe('findEmptyFbdVariables — detection', () => {
  it('flags an FBD input variable block with an empty name', () => {
    const issues = findEmptyFbdVariables(
      makeProject([makeFbdPou('main', [varNode('v1', 'input-variable', '', 16, 32)])]),
    )
    expect(issues).toEqual([{ pouName: 'main', kind: 'input', connectedTo: null, x: 16, y: 32 }])
  })

  it('flags an FBD output variable block with an empty name', () => {
    const issues = findEmptyFbdVariables(
      makeProject([makeFbdPou('main', [varNode('v1', 'output-variable', '', 48, 64)])]),
    )
    expect(issues).toEqual([{ pouName: 'main', kind: 'output', connectedTo: null, x: 48, y: 64 }])
  })

  it('treats a whitespace-only name as empty', () => {
    expect(
      findEmptyFbdVariables(makeProject([makeFbdPou('main', [varNode('v1', 'input-variable', '   ')])])),
    ).toHaveLength(1)
  })

  it('flags a variable node whose data has no variable field', () => {
    const issues = findEmptyFbdVariables(
      makeProject([makeFbdPou('main', [varNode('v1', 'output-variable', undefined)])]),
    )
    expect(issues[0]).toMatchObject({ pouName: 'main', kind: 'output', connectedTo: null })
  })

  it('passes named variable blocks', () => {
    const nodes = [varNode('v1', 'input-variable', 'T#1s'), varNode('v2', 'output-variable', 'blink_out')]
    expect(findEmptyFbdVariables(makeProject([makeFbdPou('main', nodes)]))).toEqual([])
  })

  it('ignores non-variable FBD nodes (blocks, comments, connectors)', () => {
    const nodes = [makeNode('b', 'block', {}), makeNode('c', 'comment', {}), varNode('k', 'connector', '')]
    expect(findEmptyFbdVariables(makeProject([makeFbdPou('main', nodes)]))).toEqual([])
  })

  it('ignores non-FBD POUs', () => {
    const stPou = {
      type: 'program',
      data: { name: 'st_pou', language: 'st', variables: [], documentation: '', body: { language: 'st', value: '' } },
    }
    expect(findEmptyFbdVariables(makeProject([stPou]))).toEqual([])
  })

  it('reports one entry per offending block across multiple POUs', () => {
    const a = makeFbdPou('a', [varNode('v1', 'input-variable', ''), varNode('v2', 'output-variable', 'ok')])
    const b = makeFbdPou('b', [varNode('v3', 'output-variable', '')])
    const issues = findEmptyFbdVariables(makeProject([a, b]))
    expect(issues).toHaveLength(2)
    expect(issues.map((i) => i.pouName)).toEqual(['a', 'b'])
  })
})

describe('findEmptyFbdVariables — connection description', () => {
  it('describes the block output an empty output variable is wired to', () => {
    // The real-world bug: an unnamed output wired to a function-block instance's output pin.
    const block = makeNode('blk', 'block', { variant: { name: 'blink_py' }, variable: { name: 'BLINK_PY0' } })
    const empty = varNode('out', 'output-variable', '')
    const edge: TestEdge = { id: 'e1', source: 'blk', sourceHandle: 'blink_out', target: 'out', targetHandle: 'in' }
    const issues = findEmptyFbdVariables(makeProject([makeFbdPou('main', [block, empty], [edge])]))
    expect(issues[0].connectedTo).toBe('"blink_out" of "BLINK_PY0"')
  })

  it('describes the block input pin an empty input variable drives', () => {
    const block = makeNode('blk', 'block', { variant: { name: 'TON' } })
    const empty = varNode('in', 'input-variable', '')
    const edge: TestEdge = { id: 'e1', source: 'in', sourceHandle: 'out', target: 'blk', targetHandle: 'PT' }
    const issues = findEmptyFbdVariables(makeProject([makeFbdPou('main', [empty, block], [edge])]))
    // No instance name → falls back to the block type.
    expect(issues[0].connectedTo).toBe('"PT" of "TON"')
  })

  it('labels a wired block by its type when the instance name is blank', () => {
    const block = makeNode('blk', 'block', { variant: { name: 'TON' }, variable: { name: '' } })
    const empty = varNode('out', 'output-variable', '')
    const edge: TestEdge = { id: 'e1', source: 'blk', sourceHandle: 'Q', target: 'out', targetHandle: 'in' }
    const issues = findEmptyFbdVariables(makeProject([makeFbdPou('main', [block, empty], [edge])]))
    expect(issues[0].connectedTo).toBe('"Q" of "TON"')
  })

  it('falls back to the handle alone when the wired block has no label', () => {
    const block = makeNode('blk', 'block', {})
    const empty = varNode('out', 'output-variable', '')
    const edge: TestEdge = { id: 'e1', source: 'blk', sourceHandle: 'Q', target: 'out', targetHandle: 'in' }
    const issues = findEmptyFbdVariables(makeProject([makeFbdPou('main', [block, empty], [edge])]))
    expect(issues[0].connectedTo).toBe('the "Q" pin of a block')
  })

  it('describes a wired non-block neighbour by its name', () => {
    const other = varNode('src', 'input-variable', 'sensor')
    const empty = varNode('out', 'output-variable', '')
    const edge: TestEdge = { id: 'e1', source: 'src', sourceHandle: 'out', target: 'out', targetHandle: 'in' }
    const issues = findEmptyFbdVariables(makeProject([makeFbdPou('main', [other, empty], [edge])]))
    expect(issues[0].connectedTo).toBe('"sensor"')
  })

  it('returns null when the wired neighbour cannot be labelled', () => {
    const other = varNode('src', 'continuation', '')
    const empty = varNode('out', 'output-variable', '')
    const edge: TestEdge = { id: 'e1', source: 'src', sourceHandle: 'out', target: 'out', targetHandle: 'in' }
    const issues = findEmptyFbdVariables(makeProject([makeFbdPou('main', [other, empty], [edge])]))
    expect(issues[0].connectedTo).toBeNull()
  })

  it('returns null when the edge points at a missing node', () => {
    const empty = varNode('out', 'output-variable', '')
    const edge: TestEdge = { id: 'e1', source: 'ghost', sourceHandle: 'out', target: 'out', targetHandle: 'in' }
    const issues = findEmptyFbdVariables(makeProject([makeFbdPou('main', [empty], [edge])]))
    expect(issues[0].connectedTo).toBeNull()
  })
})
