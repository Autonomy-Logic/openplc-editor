import { renderVariablesTable } from '../variables-table'
import type { DrawOp, PrintVar } from '../types'

function makeVar(overrides: Partial<PrintVar> = {}): PrintVar {
  return {
    name: 'myVar',
    varClass: 'local',
    flag: '',
    type: 'BOOL',
    location: '',
    initialValue: '',
    documentation: '',
    debug: false,
    ...overrides,
  }
}

function textOps(ops: DrawOp[]): Extract<DrawOp, { kind: 'text' }>[] {
  return ops.filter((op): op is Extract<DrawOp, { kind: 'text' }> => op.kind === 'text')
}

describe('renderVariablesTable', () => {
  it('returns no blocks for an empty variable list', () => {
    expect(renderVariablesTable([], 400, 400)).toEqual([])
  })

  it('draws the header row and every variable name, honoring debug Yes/blank', () => {
    const vars = [
      makeVar({ name: 'Input1', varClass: 'input', debug: true }),
      makeVar({ name: 'Output1', varClass: 'output', debug: false }),
    ]
    const blocks = renderVariablesTable(vars, 400, 400)
    expect(blocks).toHaveLength(1)
    const ops = textOps(blocks[0].ops)

    expect(ops.some((op) => op.text === '#')).toBe(true)
    expect(ops.some((op) => op.text === 'Name')).toBe(true)
    expect(ops.some((op) => op.text === 'Class')).toBe(true)
    expect(ops.some((op) => op.text === 'Flags')).toBe(true)
    expect(ops.some((op) => op.text === 'Type')).toBe(true)
    expect(ops.some((op) => op.text === 'Location')).toBe(true)
    expect(ops.some((op) => op.text === 'Initial Value')).toBe(true)
    expect(ops.some((op) => op.text === 'Documentation')).toBe(true)
    expect(ops.some((op) => op.text === 'Debug')).toBe(true)

    expect(ops.some((op) => op.text === 'Input1')).toBe(true)
    expect(ops.some((op) => op.text === 'Output1')).toBe(true)
    expect(ops.some((op) => op.text === 'Yes')).toBe(true)
  })

  it('paginates into multiple blocks, repeating the header row on each, when rows exceed the page height', () => {
    // HEADER_HEIGHT_PT=16, ROW_HEIGHT_PT=14 -> rowsPerPage = floor((44-16)/14) = 2
    const vars = [0, 1, 2, 3, 4].map((i) => makeVar({ name: `Var${i}` }))
    const blocks = renderVariablesTable(vars, 400, 44)
    expect(blocks).toHaveLength(3)
    for (const block of blocks) {
      expect(textOps(block.ops).some((op) => op.text === 'Name')).toBe(true)
    }
    expect(textOps(blocks[0].ops).some((op) => op.text === 'Var0')).toBe(true)
    expect(textOps(blocks[2].ops).some((op) => op.text === 'Var4')).toBe(true)
  })
})
