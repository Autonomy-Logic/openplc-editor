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

  it('builds a layout table per direction from the interface', () => {
    const variables: PLCVariable[] = [makeScalarVar('speed', 'input', 'INT'), makeScalarVar('result', 'output', 'REAL')]

    const result = injectPythonCode([{ name: 'test', code: 'pass', type: 'function-block', variables }])

    expect(result).toHaveLength(1)
    // One row per variable, split by direction: INT inbound, REAL outbound.
    expect(result[0]).toContain("(('speed',), (None,), 'h', 0, 2, None)")
    expect(result[0]).toContain("(('result',), (None,), 'f', 0, 4, None)")
  })

  it('emits empty tables when the block has no variables', () => {
    const result = injectPythonCode([{ name: 'test', code: 'pass', type: 'function-block', variables: [] }])

    expect(result[0]).toContain('_SHM_IN = ()')
    expect(result[0]).toContain('_SHM_OUT = ()')
  })

  it('returns empty array for empty pous input', () => {
    const result = injectPythonCode([])
    expect(result).toHaveLength(0)
  })

  it('separates variables by direction across the two tables', () => {
    const variables: PLCVariable[] = [
      makeScalarVar('a', 'input', 'INT'),
      makeScalarVar('b', 'input', 'REAL'),
      makeScalarVar('c', 'output', 'BOOL'),
    ]

    const result = injectPythonCode([{ name: 'test', code: 'pass', type: 'function-block', variables }])

    // Inbound: =hf (INT + REAL). Outbound: =B (BOOL).
    expect(result[0]).toContain("(('a',), (None,), 'h', 0, 2, None)")
    expect(result[0]).toContain("(('c',), (None,), 'B', 0, 1, None)")
  })

  it('puts a round-tripping class into both tables', () => {
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

    const inTable = result[0].slice(result[0].indexOf('_SHM_IN = ('), result[0].indexOf('_SHM_OUT ='))
    const outTable = result[0].slice(result[0].indexOf('_SHM_OUT = ('), result[0].indexOf('# ====='))

    // Inbound: input, then the three round-tripping classes.
    for (const name of ['a', 'io', 'keep', 'g']) {
      expect(inTable).toContain(`(('${name}',), (None,),`)
    }
    expect(inTable).not.toContain(`(('c',),`)

    // Outbound: output, then the same three.
    for (const name of ['c', 'io', 'keep', 'g']) {
      expect(outTable).toContain(`(('${name}',), (None,),`)
    }
    expect(outTable).not.toContain(`(('a',),`)
  })

  it('leaves the toolchain’s own injected locals out of both tables', () => {
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

    expect(result[0]).toContain("(('a',), (None,), 'h', 0, 2, None)")
    for (const internalName of ['first_run', 'shm_in_ptr', 'shm_out_ptr']) {
      expect(result[0]).not.toContain(`(('${internalName}',),`)
    }

    expect(result[0]).toContain("(('a',), (None,), 'h', 0, 2, None)")
    for (const internalName of ['first_run', 'shm_in_ptr', 'shm_out_ptr']) {
      expect(result[0]).not.toContain(`(('${internalName}',),`)
    }
    expect(result[0]).toContain('_SHM_OUT = ()')
  })
})
