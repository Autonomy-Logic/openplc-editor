import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { injectPythonCode } from '../injectPythonCode'

const makeScalarVar = (name: string, cls: 'input' | 'output', baseType: string): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: baseType },
  location: '',
  documentation: '',
  debug: false,
})

describe('injectPythonCode', () => {
  it('returns an array of injected code strings, one per pou', () => {
    const result = injectPythonCode([
      {
        name: 'block1',
        code: 'def block_init():\n    pass\ndef block_loop():\n    pass',
        type: 'function-block',
        variables: [],
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toContain('block_init()')
    expect(result[0]).toContain('block_loop()')
    expect(result[0]).toContain('Stopping Python block: block1')
  })

  it('processes multiple pous independently', () => {
    const result = injectPythonCode([
      { name: 'pou1', code: 'pass', type: 'function-block', variables: [] },
      { name: 'pou2', code: 'pass', type: 'function-block', variables: [] },
    ])

    expect(result).toHaveLength(2)
    expect(result[0]).toContain('Stopping Python block: pou1')
    expect(result[1]).toContain('Stopping Python block: pou2')
  })

  it('generates format strings from input and output variables', () => {
    const variables: PLCVariable[] = [makeScalarVar('speed', 'input', 'INT'), makeScalarVar('result', 'output', 'REAL')]

    const result = injectPythonCode([{ name: 'test', code: 'pass', type: 'function-block', variables }])

    expect(result).toHaveLength(1)
    // Input format: =h (INT)
    expect(result[0]).toContain("fmt_in = ('=h')")
    // Output format: =f (REAL)
    expect(result[0]).toContain("fmt_out = ('=f')")
  })

  it('injects runtime with empty format when no variables', () => {
    const result = injectPythonCode([{ name: 'test', code: 'pass', type: 'function-block', variables: [] }])

    expect(result[0]).toContain("fmt_in = ('=')")
    expect(result[0]).toContain("fmt_out = ('=')")
  })

  it('returns empty array for empty pous input', () => {
    const result = injectPythonCode([])
    expect(result).toHaveLength(0)
  })

  it('separates variables by direction for format encoding', () => {
    const variables: PLCVariable[] = [
      makeScalarVar('a', 'input', 'INT'),
      makeScalarVar('b', 'input', 'REAL'),
      makeScalarVar('c', 'output', 'BOOL'),
    ]

    const result = injectPythonCode([{ name: 'test', code: 'pass', type: 'function-block', variables }])

    // Inbound: =hf (INT + REAL). Outbound: =B (BOOL).
    expect(result[0]).toContain("fmt_in = ('=hf')")
    expect(result[0]).toContain("fmt_out = ('=B')")
  })

  it('puts a round-tripping class into both formats', () => {
    // A VAR, a VAR_IN_OUT and a VAR_EXTERNAL all travel out and back, so each
    // appears in both structs. The PLC keeps owning the value; a block that
    // never assigns one sends back what it received.
    const byClass = (name: string, cls: PLCVariable['class']): PLCVariable => ({
      name,
      class: cls,
      type: { definition: 'base-type', value: 'INT' },
      location: '',
      documentation: '',
      debug: false,
    })
    const variables: PLCVariable[] = [
      makeScalarVar('a', 'input', 'INT'),
      makeScalarVar('c', 'output', 'BOOL'),
      byClass('io', 'inOut'),
      byClass('keep', 'local'),
      byClass('g', 'external'),
    ]

    const result = injectPythonCode([{ name: 'test', code: 'pass', type: 'function-block', variables }])

    // Inbound: input then inOut, local, external — all INT (h).
    expect(result[0]).toContain("fmt_in = ('=hhhh')")
    // Outbound: output (B) then the same three.
    expect(result[0]).toContain("fmt_out = ('=Bhhh')")
  })

  it('leaves the toolchain’s own injected locals out of both formats', () => {
    // `first_run` and the two segment addresses are declared `local`. Sweeping
    // them in would hand the block its own segment pointers to overwrite.
    const internal = (name: string, type: string): PLCVariable => ({
      name,
      class: 'local',
      type: { definition: 'base-type', value: type },
      location: '',
      documentation: '',
      debug: false,
    })
    const variables: PLCVariable[] = [
      makeScalarVar('a', 'input', 'INT'),
      internal('first_run', 'BOOL'),
      internal('shm_in_ptr', 'ULINT'),
      internal('shm_out_ptr', 'ULINT'),
    ]

    const result = injectPythonCode([{ name: 'test', code: 'pass', type: 'function-block', variables }])

    expect(result[0]).toContain("fmt_in = ('=h')")
    expect(result[0]).toContain("fmt_out = ('=')")
  })
})
