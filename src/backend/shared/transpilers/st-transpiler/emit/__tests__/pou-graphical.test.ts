/**
 * End-to-end regression for issue #944 ("Type Conversion TO_INT not
 * working") at the level `generateGraphicalPou` actually runs at: a full
 * `TranspilePou` + `TranspileProject`, exactly like the compile pipeline
 * (`backend/shared/compile/pipeline.ts`) feeds it.
 *
 * Reproduces the reported project shape: a PROGRAM with a REAL variable
 * (`O_R`) wired into a `TO_INT` conversion block on an FBD network,
 * feeding an INT output variable — the exact pattern that produced
 * `_TMP_TO_INT6913197_OUT := TO_INT(O_R);` in the issue's generated
 * `webserver_program.st` and made matiec fail with `';' missing at the
 * end of statement`.
 */

import type { RFNode } from '../../walker/types'
import type { TranspilePou, TranspileProject } from '../../types'
import { generateGraphicalPou } from '../pou-graphical'

function inputVariableNode(id: string, name: string): RFNode {
  return {
    id,
    type: 'input-variable',
    position: { x: 0, y: 0 },
    data: { variant: 'input-variable', variable: { name }, executionOrder: 0 },
  }
}

function outputVariableNode(id: string, name: string): RFNode {
  return {
    id,
    type: 'output-variable',
    position: { x: 100, y: 0 },
    data: { variant: 'output-variable', variable: { name }, executionOrder: 0 },
  }
}

function conversionBlockNode(id: string, typeName: string, numericId: string): RFNode {
  return {
    id,
    type: 'block',
    position: { x: 50, y: 0 },
    data: {
      variant: {
        name: typeName,
        type: 'function',
        variables: [
          { name: 'IN', class: 'input' },
          { name: 'OUT', class: 'output' },
        ],
      },
      numericId,
      executionOrder: 0,
    },
  }
}

function emptyProject(pous: TranspilePou[]): TranspileProject {
  return {
    dataTypes: [],
    pous,
    configuration: { tasks: [], instances: [], globalVariables: [] },
  }
}

describe('generateGraphicalPou — polymorphic conversion call resolution (issue #944)', () => {
  it('emits REAL_TO_INT, not the bare TO_INT shorthand, for a REAL local wired into a TO_INT block', () => {
    const pou: TranspilePou = {
      name: 'main',
      pouType: 'program',
      interface: {
        variables: [
          { name: 'O_R', type: { definition: 'base-type', value: 'REAL' }, class: 'local' },
          { name: 'OFFICE_TEMP', type: { definition: 'base-type', value: 'INT' }, class: 'local' },
        ],
      },
      body: {
        language: 'fbd',
        value: {
          rung: {
            nodes: [
              inputVariableNode('in1', 'O_R'),
              conversionBlockNode('blk1', 'TO_INT', '6913197'),
              outputVariableNode('out1', 'OFFICE_TEMP'),
            ],
            edges: [
              { id: 'e1', source: 'in1', target: 'blk1', targetHandle: 'IN' },
              { id: 'e2', source: 'blk1', target: 'out1', sourceHandle: 'OUT' },
            ],
          },
        },
      },
    }

    const chunks = generateGraphicalPou(pou, emptyProject([pou]))
    const text = chunks.map((c) => c[0]).join('')

    expect(text).toContain('REAL_TO_INT(O_R)')
    expect(text).not.toMatch(/:=\s*TO_INT\(/)
    // The output temp's declared type must also resolve off ANY (the
    // sibling defect PR #854 fixed) — belt-and-suspenders check that
    // this change didn't regress that.
    expect(text).toMatch(/_TMP_TO_INT6913197_OUT\s*:\s*INT/)
  })

  it('resolves the source type from a project global variable when the POU has no matching local', () => {
    const pou: TranspilePou = {
      name: 'main',
      pouType: 'program',
      interface: {
        variables: [{ name: 'OFFICE_TEMP', type: { definition: 'base-type', value: 'INT' }, class: 'local' }],
      },
      body: {
        language: 'fbd',
        value: {
          rung: {
            nodes: [
              inputVariableNode('in1', 'G_TEMP'),
              conversionBlockNode('blk1', 'TO_INT', '42'),
              outputVariableNode('out1', 'OFFICE_TEMP'),
            ],
            edges: [
              { id: 'e1', source: 'in1', target: 'blk1', targetHandle: 'IN' },
              { id: 'e2', source: 'blk1', target: 'out1', sourceHandle: 'OUT' },
            ],
          },
        },
      },
    }
    const project = emptyProject([pou])
    project.configuration.globalVariables.push({
      name: 'G_TEMP',
      type: { definition: 'base-type', value: 'REAL' },
      class: 'external',
    })

    const chunks = generateGraphicalPou(pou, project)
    const text = chunks.map((c) => c[0]).join('')

    expect(text).toContain('REAL_TO_INT(G_TEMP)')
  })

  it('does not index derived variable types as conversion sources', () => {
    const pou: TranspilePou = {
      name: 'main',
      pouType: 'program',
      interface: {
        variables: [
          { name: 'DERIVED_TEMP', type: { definition: 'derived', value: 'REAL_ALIAS' }, class: 'local' },
          { name: 'OFFICE_TEMP', type: { definition: 'base-type', value: 'INT' }, class: 'local' },
        ],
      },
      body: {
        language: 'fbd',
        value: {
          rung: {
            nodes: [
              inputVariableNode('in1', 'DERIVED_TEMP'),
              conversionBlockNode('blk1', 'TO_INT', '43'),
              outputVariableNode('out1', 'OFFICE_TEMP'),
            ],
            edges: [
              { id: 'e1', source: 'in1', target: 'blk1', targetHandle: 'IN' },
              { id: 'e2', source: 'blk1', target: 'out1', sourceHandle: 'OUT' },
            ],
          },
        },
      },
    }

    const chunks = generateGraphicalPou(pou, emptyProject([pou]))
    const text = chunks.map((c) => c[0]).join('')

    expect(text).toContain('TO_INT(DERIVED_TEMP)')
    expect(text).not.toContain('REAL_ALIAS_TO_INT(DERIVED_TEMP)')
  })
})
