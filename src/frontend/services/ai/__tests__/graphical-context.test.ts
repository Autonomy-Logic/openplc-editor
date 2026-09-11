/**
 * Graphical context is what stands in for a diagram the model cannot read: the
 * transpiled ST plus a description of the layout. Two failure modes matter and
 * both are silent. The module-level ST cache can answer a question about a
 * project that no longer exists (an edit landed, the cache did not clear), and
 * a failed transpile can be presented as an empty POU — the model then
 * confidently tells the user their diagram does nothing.
 *
 * The transpiler is a parameter, so nothing here mocks a module and the file
 * runs under jest (editor) and vitest (web) alike. `Date.now` is spied rather
 * than waiting out the real 30s TTL.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import type { Edge, Node } from '@xyflow/react'

import type { PLCProjectData } from '../../../../middleware/shared/ports/types'
import type { FBDFlowType } from '../../../store/slices/fbd/types'
import type { LadderFlowType, RungLadderState } from '../../../store/slices/ladder/types'
import {
  extractPouST,
  generateFBDLayoutMetadata,
  generateGraphicalContext,
  generateLadderLayoutMetadata,
  invalidateSTCache,
  type ProjectStTranspiler,
  transpileProjectToST,
} from '../graphical-context'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emptyProject: PLCProjectData = {
  dataTypes: [],
  pous: [],
  configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
  servers: [],
  remoteDevices: [],
  libraries: [],
}

/** A transpiler that records its calls so a test can prove the cache was used. */
function countingTranspiler(answers: Array<string | null>): {
  transpile: ProjectStTranspiler
  callCount: () => number
} {
  let calls = 0
  const transpile: ProjectStTranspiler = () => {
    const answer = answers[Math.min(calls, answers.length - 1)]
    calls += 1
    return Promise.resolve(answer)
  }
  return { transpile, callCount: () => calls }
}

function node(id: string, type: string, data: Record<string, unknown>, x = 0): Node {
  return { id, type, position: { x, y: 0 }, data }
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target }
}

function rung(overrides: Partial<RungLadderState> = {}): RungLadderState {
  return {
    id: 'rung-1',
    comment: '',
    defaultBounds: [0, 0],
    reactFlowViewport: [0, 0],
    selectedNodes: [],
    nodes: [],
    edges: [],
    ...overrides,
  }
}

function ladderFlow(rungs: RungLadderState[]): LadderFlowType {
  return { name: 'Rungs', updated: false, rungs }
}

function fbdFlow(nodes: Node[], edges: Edge[] = []): FBDFlowType {
  return { name: 'Blocks', updated: false, rung: { comment: '', selectedNodes: [], nodes, edges } }
}

/** Move the module's clock forward past the 30s cache TTL. */
function advanceClockBy(ms: number): void {
  const base = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(base + ms)
}

beforeEach(() => {
  // The cache lives at module scope, so one case's ST would otherwise answer
  // the next case's question.
  invalidateSTCache()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// transpileProjectToST
// ---------------------------------------------------------------------------

describe('transpileProjectToST', () => {
  it('transpiles once and serves the cached ST for the rest of a chat turn', async () => {
    // A chat send asks for the whole project's ST several times over; without
    // the cache that is one full transpile per POU read.
    const { transpile, callCount } = countingTranspiler(['PROGRAM Main\nEND_PROGRAM'])

    const first = await transpileProjectToST(emptyProject, transpile)
    const second = await transpileProjectToST(emptyProject, transpile)

    expect(first).toBe('PROGRAM Main\nEND_PROGRAM')
    expect(second).toBe(first)
    expect(callCount()).toBe(1)
  })

  it('transpiles again once the cached ST has aged out', async () => {
    const { transpile, callCount } = countingTranspiler(['FIRST', 'SECOND'])
    await transpileProjectToST(emptyProject, transpile)

    advanceClockBy(31_000)
    const refreshed = await transpileProjectToST(emptyProject, transpile)

    expect(refreshed).toBe('SECOND')
    expect(callCount()).toBe(2)
  })

  it('answers null when no transpiler is wired up and nothing is cached', async () => {
    // The desktop and the web reach the transpiler differently; a build that
    // has not wired one yet must read as "no ST", not as an empty project.
    expect(await transpileProjectToST(emptyProject)).toBeNull()
  })

  it('keeps answering the last good ST when a later refresh cannot produce any', async () => {
    // Stale code is still the user's code. Dropping to null here would make
    // every graphical POU look empty the moment one transpile hiccupped.
    const { transpile } = countingTranspiler(['GOOD', null])
    await transpileProjectToST(emptyProject, transpile)

    advanceClockBy(31_000)

    expect(await transpileProjectToST(emptyProject, transpile)).toBe('GOOD')
  })

  it('answers null when the first transpile produces nothing', async () => {
    expect(await transpileProjectToST(emptyProject, countingTranspiler([null]).transpile)).toBeNull()
  })

  it('swallows a transpiler rejection rather than propagating it to the tool layer', async () => {
    // `read_pou_body` relies on this never throwing: a dead worker has to
    // surface as a failed tool result, not as a crashed chat turn.
    const rejecting: ProjectStTranspiler = () => Promise.reject(new Error('worker died'))

    expect(await transpileProjectToST(emptyProject, rejecting)).toBeNull()
  })

  it('falls back to the cached ST when a refresh rejects', async () => {
    const rejecting: ProjectStTranspiler = () => Promise.reject(new Error('worker died'))
    await transpileProjectToST(emptyProject, countingTranspiler(['GOOD']).transpile)

    advanceClockBy(31_000)

    expect(await transpileProjectToST(emptyProject, rejecting)).toBe('GOOD')
  })
})

describe('invalidateSTCache', () => {
  it('drops the text, not just its timestamp, so an edited diagram cannot answer as the old one', async () => {
    // If only the timestamp were cleared, a failed transpile after an edit
    // would fall back to ST describing a project that no longer exists.
    const rejecting: ProjectStTranspiler = () => Promise.reject(new Error('worker died'))
    await transpileProjectToST(emptyProject, countingTranspiler(['BEFORE THE EDIT']).transpile)

    invalidateSTCache()

    expect(await transpileProjectToST(emptyProject, rejecting)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// extractPouST
// ---------------------------------------------------------------------------

describe('extractPouST', () => {
  const program = 'PROGRAM Main\n  a := 1;\nEND_PROGRAM'
  const functionBlock = 'FUNCTION_BLOCK Debounce\n  q := TRUE;\nEND_FUNCTION_BLOCK'
  const fn = 'FUNCTION Scale : REAL\n  Scale := 1.0;\nEND_FUNCTION'
  const whole = `${program}\n\n${functionBlock}\n\n${fn}`

  it('extracts a program from the whole-project ST', () => {
    expect(extractPouST(whole, 'Main', 'program')).toBe(program)
  })

  it('extracts a function block by its own keyword pair', () => {
    // PROGRAM is a prefix of nothing, but FUNCTION is a prefix of
    // FUNCTION_BLOCK — picking the wrong keyword returns the wrong POU's code.
    expect(extractPouST(whole, 'Debounce', 'function-block')).toBe(functionBlock)
  })

  it('extracts a function without swallowing the function block above it', () => {
    expect(extractPouST(whole, 'Scale', 'function')).toBe(fn)
  })

  it('answers an empty string for a POU the transpiler did not emit', () => {
    // The caller reads this as "no ST for this POU" and says so, instead of
    // handing the model an empty body.
    expect(extractPouST(whole, 'Missing', 'program')).toBe('')
  })

  it('does not match a POU whose name merely starts the same', () => {
    expect(extractPouST('PROGRAM MainLoop\n  a := 1;\nEND_PROGRAM', 'Main', 'program')).toBe('')
  })

  it('treats regex metacharacters in a POU name as literal text', () => {
    // A name the ST transpiler mangles into something regex-flavoured must not
    // turn the extraction into a wildcard that grabs a neighbouring POU.
    const st = 'PROGRAM A.B\n  x := 1;\nEND_PROGRAM\n\nPROGRAM AXB\n  y := 2;\nEND_PROGRAM'

    expect(extractPouST(st, 'A.B', 'program')).toBe('PROGRAM A.B\n  x := 1;\nEND_PROGRAM')
  })
})

// ---------------------------------------------------------------------------
// Ladder layout metadata
// ---------------------------------------------------------------------------

describe('generateLadderLayoutMetadata', () => {
  it('says the diagram is empty rather than emitting a header with nothing under it', () => {
    expect(generateLadderLayoutMetadata(ladderFlow([]))).toBe('(* Empty ladder diagram *)')
  })

  it('lists contacts, blocks and coils left to right, which is execution order in ladder', () => {
    // The nodes arrive in whatever order the editor stored them; presenting
    // them unsorted describes a rung that reads backwards.
    const metadata = generateLadderLayoutMetadata(
      ladderFlow([
        rung({
          nodes: [
            node('c2', 'contact', { variable: { name: 'stop' }, variant: 'negated' }, 200),
            node('c1', 'contact', { variable: { name: 'start' }, variant: 'default' }, 100),
            node('coil1', 'coil', { variable: { name: 'motor' }, variant: 'set' }, 500),
            node('b1', 'block', { variant: { name: 'TON' }, variable: { name: 'timer' } }, 300),
          ],
        }),
      ]),
    )

    expect(metadata).toContain('(* === Diagram Layout Metadata === *)')
    expect(metadata).toContain('Rung 1 [id=rung-1]: 4 elements')
    const lines = metadata.split('\n')
    expect(lines.slice(2, 6)).toEqual([
      '   - Contact "start" (default)',
      '   - Contact "stop" (negated)',
      '   - Block "TON" instance "timer"',
      '   - Coil "motor" (set) *)',
    ])
  })

  it('marks an unbound element rather than omitting it, so the model sees the gap', () => {
    const metadata = generateLadderLayoutMetadata(
      ladderFlow([rung({ nodes: [node('c1', 'contact', {}), node('coil1', 'coil', {}, 100)] })]),
    )

    expect(metadata).toContain('Contact "???" (default)')
    expect(metadata).toContain('Coil "???" (default)')
  })

  it('names an unrecognised block type rather than dropping the block', () => {
    const metadata = generateLadderLayoutMetadata(ladderFlow([rung({ nodes: [node('b1', 'block', {})] })]))

    expect(metadata).toContain('Block "Unknown" instance ""')
  })

  it('flags parallel branches, which the flattened element list cannot convey', () => {
    const metadata = generateLadderLayoutMetadata(
      ladderFlow([
        rung({
          comment: 'Motor seal-in',
          nodes: [node('p1', 'parallel', {}), node('c1', 'contact', { variable: { name: 'start' } })],
        }),
      ]),
    )

    // The parallel node itself is not an element, so the count stays at 1.
    expect(metadata).toContain('Rung 1 [id=rung-1]: 1 elements — Motor seal-in [has parallel branches]')
  })

  it('numbers rungs from one, matching what the editor shows the user', () => {
    const metadata = generateLadderLayoutMetadata(ladderFlow([rung({ id: 'a' }), rung({ id: 'b' })]))

    expect(metadata).toContain('Rung 1 [id=a]')
    expect(metadata).toContain('Rung 2 [id=b]')
  })
})

// ---------------------------------------------------------------------------
// FBD layout metadata
// ---------------------------------------------------------------------------

describe('generateFBDLayoutMetadata', () => {
  it('says the diagram is empty rather than emitting a header with nothing under it', () => {
    expect(generateFBDLayoutMetadata(fbdFlow([]))).toBe('(* Empty FBD diagram *)')
  })

  it('lists blocks in execution order with the sources feeding each one', () => {
    // In FBD, position carries no meaning — executionOrder does. Listing the
    // blocks by array order would describe a program that runs differently.
    const metadata = generateFBDLayoutMetadata(
      fbdFlow(
        [
          node('b2', 'block', { variant: { name: 'SUB' }, variable: { name: 'sub1' }, executionOrder: 2 }),
          node('b1', 'block', { variant: { name: 'ADD' }, variable: { name: 'add1' }, executionOrder: 1 }),
          node('in1', 'input-variable', { variable: { name: 'a' } }),
          node('out1', 'output-variable', { variable: { name: 'result' } }),
        ],
        [edge('e1', 'in1', 'b1'), edge('e2', 'b1', 'b2'), edge('e3', 'b2', 'out1')],
      ),
    )

    expect(metadata).toContain('(* FBD: 2 blocks, 1 inputs, 1 outputs')
    expect(metadata).toContain('   - Input variable: "a"')
    expect(metadata.indexOf('instance "add1"')).toBeLessThan(metadata.indexOf('instance "sub1"'))
    expect(metadata).toContain('Block "ADD" instance "add1" (exec #1) <- [a]')
    expect(metadata).toContain('Block "SUB" instance "sub1" (exec #2) <- [add1]')
    expect(metadata).toContain('   - Output variable: "result" <- SUB')
  })

  it('omits the arrow for a block nothing feeds, rather than printing an empty list', () => {
    const metadata = generateFBDLayoutMetadata(
      fbdFlow([node('b1', 'block', { variant: { name: 'ADD' }, variable: { name: 'add1' }, executionOrder: 1 })]),
    )

    expect(metadata).toContain('Block "ADD" instance "add1" (exec #1)')
    expect(metadata).not.toContain('<-')
  })

  it('falls back to the node type when a source carries neither a variable nor a variant', () => {
    const metadata = generateFBDLayoutMetadata(
      fbdFlow(
        [node('c1', 'connector', {}), node('b1', 'block', { variant: { name: 'ADD' }, executionOrder: 1 })],
        [edge('e1', 'c1', 'b1')],
      ),
    )

    expect(metadata).toContain('<- [connector]')
  })

  it('marks a dangling edge rather than silently describing a connection that is not there', () => {
    const metadata = generateFBDLayoutMetadata(
      fbdFlow([node('b1', 'block', { variant: { name: 'ADD' }, executionOrder: 1 })], [edge('e1', 'gone', 'b1')]),
    )

    expect(metadata).toContain('<- [?]')
  })

  it('marks an output variable nothing drives', () => {
    // An unconnected output is a real defect in the diagram; it has to reach
    // the model rather than being rendered as if it were wired.
    const metadata = generateFBDLayoutMetadata(fbdFlow([node('out1', 'output-variable', {})]))

    expect(metadata).toContain('Output variable: "???" <- ?')
  })

  it('treats a block with no execution order as first rather than dropping it', () => {
    const metadata = generateFBDLayoutMetadata(
      fbdFlow([
        node('b1', 'block', { variant: { name: 'ADD' }, executionOrder: 3 }),
        node('b2', 'block', { variant: { name: 'SUB' } }),
      ]),
    )

    expect(metadata.indexOf('"SUB"')).toBeLessThan(metadata.indexOf('"ADD"'))
    expect(metadata).toContain('Block "SUB" instance "" (exec #0)')
  })
})

// ---------------------------------------------------------------------------
// generateGraphicalContext
// ---------------------------------------------------------------------------

describe('generateGraphicalContext', () => {
  it('leads with the POU identity, then the ST, then the layout, then the project', () => {
    const context = generateGraphicalContext(
      'Rungs',
      'program',
      'ld',
      'PROGRAM Rungs\nEND_PROGRAM',
      '(* layout *)',
      '(* project *)',
    )

    expect(context.split('\n\n')).toEqual([
      '(* Current POU: Rungs [program] language=ld *)',
      '(* === Equivalent Structured Text (transpiled from Ladder Diagram) === *)\nPROGRAM Rungs\nEND_PROGRAM',
      '(* layout *)',
      '(* project *)',
    ])
  })

  it('names the FBD dialect in the ST heading so the model knows what it is reading', () => {
    const context = generateGraphicalContext('Blocks', 'function-block', 'fbd', 'X', '(* layout *)', '')

    expect(context).toContain('transpiled from Function Block Diagram')
  })

  it.each([null, ''])('says the ST is unavailable (%p) instead of presenting the POU as empty', (stCode) => {
    // Omitting the section would read as "this POU has no code" — the single
    // most damaging thing the model could be told about a working diagram.
    const context = generateGraphicalContext('Rungs', 'program', 'ld', stCode, '(* layout *)', '')

    expect(context).toContain('(* ST transpilation unavailable — using layout metadata only *)')
    expect(context).not.toContain('Equivalent Structured Text')
  })

  it('omits the project section entirely when there is none', () => {
    const context = generateGraphicalContext('Rungs', 'program', 'ld', 'X', '(* layout *)', '')

    expect(context.endsWith('(* layout *)')).toBe(true)
  })
})
