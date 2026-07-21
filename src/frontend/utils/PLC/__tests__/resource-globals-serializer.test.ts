import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { serializeResourceGlobalsToST } from '../resource-globals-serializer'

function global(name: string, typeValue: string, extra: Partial<PLCVariable> = {}): PLCVariable {
  return { name, type: { definition: 'base-type', value: typeValue }, location: '', documentation: '', ...extra }
}

describe('serializeResourceGlobalsToST', () => {
  it('returns empty string when there are no globals', () => {
    expect(serializeResourceGlobalsToST([])).toBe('')
  })

  it('wraps the globals in a CONFIGURATION so VAR_EXTERNAL resolves', () => {
    const st = serializeResourceGlobalsToST([global('test_global', 'DINT')])
    expect(st).toContain('CONFIGURATION')
    expect(st).toContain('VAR_GLOBAL')
    expect(st).toContain('test_global : DINT;')
    expect(st).toContain('END_VAR')
    expect(st).toContain('RESOURCE')
    expect(st).toContain('END_CONFIGURATION')
    // Globals must be at the CONFIGURATION level, before the RESOURCE block.
    expect(st.indexOf('VAR_GLOBAL')).toBeLessThan(st.indexOf('RESOURCE'))
  })

  it('emits a single VAR_GLOBAL block even if a stored global carries a stray class', () => {
    const st = serializeResourceGlobalsToST([global('a', 'INT', { class: 'external' }), global('b', 'BOOL')])
    // Both land in one VAR_GLOBAL block; no VAR_EXTERNAL leaks in.
    expect(st).not.toContain('VAR_EXTERNAL')
    expect((st.match(/VAR_GLOBAL/g) ?? []).length).toBe(1)
    expect(st).toContain('a : INT;')
    expect(st).toContain('b : BOOL;')
  })

  it('preserves location and initial value', () => {
    const st = serializeResourceGlobalsToST([global('counter', 'INT', { location: '%MW0', initialValue: '5' })])
    expect(st).toContain('counter : INT AT %MW0 := 5;')
  })
})
