/**
 * Regression coverage for polymorphic IEC 61131-3 conversion-block call
 * emission (GitHub issue #944 — "Type Conversion TO_INT not working").
 *
 * A `TO_INT` (or `TO_UINT`, `TO_REAL`, …) block is placed on the FBD/LD
 * canvas with the generic shorthand as its type name — that's how the
 * editor's block library exposes the IEC 61131-3 polymorphic conversion
 * family. But the shorthand is not itself a valid ST function; only the
 * fully qualified `<SRC>_TO_<DST>` form (`REAL_TO_INT`, `BOOL_TO_INT`, …)
 * exists in the standard (see `data/std_block_catalog.json`, which never
 * has a bare `TO_INT` entry). Emitting the shorthand verbatim into the
 * generated ST produces a call to an undefined function, which matiec /
 * strucpp reject — exactly the `';' missing at the end of statement`
 * parse error reported in issue #944 for `TO_INT(O_R)`.
 */

import { emitLdBody } from '../ld'
import type { TypeContext } from '../connection-types'
import type { RFBody, RFEdge, RFNode } from '../types'

function typeContext(entries: [string, string][]): TypeContext {
  const variableTypes = new Map(entries)
  return {
    variableType: (expression) => variableTypes.get(expression) ?? null,
    resolveBlock: () => null,
  }
}

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

function twoInputBlockNode(id: string, typeName: string, numericId: string): RFNode {
  return {
    id,
    type: 'block',
    position: { x: 50, y: 0 },
    data: {
      variant: {
        name: typeName,
        type: 'function',
        variables: [
          { name: 'IN1', class: 'input' },
          { name: 'IN2', class: 'input' },
          { name: 'OUT', class: 'output' },
        ],
      },
      numericId,
      executionOrder: 0,
    },
  }
}

function edge(id: string, source: string, target: string, sourceHandle?: string, targetHandle?: string): RFEdge {
  return { id, source, target, sourceHandle, targetHandle }
}

describe('emitLdBody — polymorphic TO_<TYPE> conversion call resolution', () => {
  it('resolves TO_INT to REAL_TO_INT when the wired input is a declared REAL variable (issue #944)', () => {
    const body: RFBody = {
      rungs: [
        {
          nodes: [
            inputVariableNode('in1', 'O_R'),
            conversionBlockNode('blk1', 'TO_INT', '6913197'),
            outputVariableNode('out1', 'OFFICE_TEMP'),
          ],
          edges: [edge('e1', 'in1', 'blk1', undefined, 'IN'), edge('e2', 'blk1', 'out1', 'OUT', undefined)],
        },
      ],
    }

    const result = emitLdBody(body, typeContext([['O_R', 'REAL']]))

    expect(result.bodySt).toContain('REAL_TO_INT(O_R)')
    expect(result.bodySt).not.toMatch(/:=\s*TO_INT\(/)
  })

  it('leaves the shorthand name unchanged when the source type is not known (no regression / fail-open)', () => {
    const body: RFBody = {
      rungs: [
        {
          nodes: [
            inputVariableNode('in1', 'O_R'),
            conversionBlockNode('blk1', 'TO_INT', '6913197'),
            outputVariableNode('out1', 'OFFICE_TEMP'),
          ],
          edges: [edge('e1', 'in1', 'blk1', undefined, 'IN'), edge('e2', 'blk1', 'out1', 'OUT', undefined)],
        },
      ],
    }

    // No variable-type index supplied at all.
    const result = emitLdBody(body)

    expect(result.bodySt).toMatch(/:=\s*TO_INT\(O_R\)/)
  })

  it('leaves the shorthand name unchanged when the input is unconnected', () => {
    const body: RFBody = {
      rungs: [
        {
          nodes: [conversionBlockNode('blk1', 'TO_INT', '6913197'), outputVariableNode('out1', 'OFFICE_TEMP')],
          edges: [edge('e2', 'blk1', 'out1', 'OUT', undefined)],
        },
      ],
    }

    const result = emitLdBody(body, typeContext([['O_R', 'REAL']]))

    expect(result.bodySt).toContain('TO_INT()')
  })

  it("leaves the shorthand unchanged when the input is another block's output", () => {
    const body: RFBody = {
      rungs: [
        {
          nodes: [
            conversionBlockNode('source', 'TRUNC', '41'),
            conversionBlockNode('conversion', 'TO_INT', '42'),
            outputVariableNode('out1', 'OFFICE_TEMP'),
          ],
          edges: [edge('e1', 'source', 'conversion', 'OUT', 'IN'), edge('e2', 'conversion', 'out1', 'OUT', undefined)],
        },
      ],
    }

    const result = emitLdBody(body, typeContext([['_TMP_TRUNC41_OUT', 'REAL']]))

    expect(result.bodySt).toContain('TO_INT(_TMP_TRUNC41_OUT)')
    expect(result.bodySt).not.toContain('REAL_TO_INT(_TMP_TRUNC41_OUT)')
  })

  it('leaves the shorthand name unchanged when there is no known conversion from the source type to the target', () => {
    const body: RFBody = {
      rungs: [
        {
          nodes: [
            inputVariableNode('in1', 'WEIRD_SOURCE'),
            conversionBlockNode('blk1', 'TO_INT', '6913197'),
            outputVariableNode('out1', 'OFFICE_TEMP'),
          ],
          edges: [edge('e1', 'in1', 'blk1', undefined, 'IN'), edge('e2', 'blk1', 'out1', 'OUT', undefined)],
        },
      ],
    }

    // `NOT_A_REAL_TYPE_TO_INT` isn't a supported compiler conversion —
    // fall back to the shorthand rather than emit that non-existent name.
    const result = emitLdBody(body, typeContext([['WEIRD_SOURCE', 'NOT_A_REAL_TYPE']]))

    expect(result.bodySt).toContain('TO_INT(WEIRD_SOURCE)')
  })

  it('does not touch non-conversion function calls (e.g. ADD) even when they have exactly one wired input', () => {
    const body: RFBody = {
      rungs: [
        {
          nodes: [
            inputVariableNode('in1', 'A'),
            conversionBlockNode('blk1', 'TRUNC', '42'),
            outputVariableNode('out1', 'B'),
          ],
          edges: [edge('e1', 'in1', 'blk1', undefined, 'IN'), edge('e2', 'blk1', 'out1', 'OUT', undefined)],
        },
      ],
    }

    const result = emitLdBody(body, typeContext([['A', 'REAL']]))

    expect(result.bodySt).toContain('TRUNC(A)')
  })

  it('resolves sibling conversions the same way (TO_DINT from a BOOL source)', () => {
    const body: RFBody = {
      rungs: [
        {
          nodes: [
            inputVariableNode('in1', 'FLAG'),
            conversionBlockNode('blk1', 'TO_DINT', '7'),
            outputVariableNode('out1', 'OUT_VAR'),
          ],
          edges: [edge('e1', 'in1', 'blk1', undefined, 'IN'), edge('e2', 'blk1', 'out1', 'OUT', undefined)],
        },
      ],
    }

    const result = emitLdBody(body, typeContext([['FLAG', 'BOOL']]))

    expect(result.bodySt).toContain('BOOL_TO_DINT(FLAG)')
  })

  it('leaves multi-input blocks named like a conversion shorthand alone (defensive — real conversions never have 2 inputs)', () => {
    const body: RFBody = {
      rungs: [
        {
          nodes: [
            inputVariableNode('in1', 'A'),
            inputVariableNode('in2', 'B'),
            twoInputBlockNode('blk1', 'TO_INT', '9'),
            outputVariableNode('out1', 'OUT_VAR'),
          ],
          edges: [
            edge('e1', 'in1', 'blk1', undefined, 'IN1'),
            edge('e2', 'in2', 'blk1', undefined, 'IN2'),
            edge('e3', 'blk1', 'out1', 'OUT', undefined),
          ],
        },
      ],
    }

    const result = emitLdBody(
      body,
      typeContext([
        ['A', 'REAL'],
        ['B', 'REAL'],
      ]),
    )

    expect(result.bodySt).toContain('TO_INT(')
  })
})
