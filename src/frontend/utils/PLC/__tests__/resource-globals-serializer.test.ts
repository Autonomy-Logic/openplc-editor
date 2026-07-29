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

  // A global bound to a producer alias stores the alias NAME in `location`.
  // `AT <alias>` is not valid IEC ST and would take the whole VAR_GLOBAL block
  // — and every VAR_EXTERNAL that resolves against it — down with it.
  it('resolves an alias-bound location to its IEC address', () => {
    const st = serializeResourceGlobalsToST(
      [global('pressure', 'INT', { location: 'tank_alias' })],
      new Map([['tank_alias', '%IW4']]),
    )
    expect(st).toContain('pressure : INT AT %IW4;')
    expect(st).not.toContain('AT tank_alias')
  })

  it('drops an alias that no longer resolves instead of emitting invalid ST', () => {
    const st = serializeResourceGlobalsToST([global('pressure', 'INT', { location: 'gone' })], new Map())
    expect(st).toContain('pressure : INT;')
    expect(st).not.toContain('AT gone')
  })

  it('never emits a bare alias identifier when no index is supplied', () => {
    const st = serializeResourceGlobalsToST([global('pressure', 'INT', { location: 'tank_alias' })])
    expect(st).toContain('pressure : INT;')
    expect(st).not.toContain('AT tank_alias')
  })
})
