import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { pouDebugExpressions, pouDebugKey, pouExternalNames } from '../debug-pou-key'

const variable = (name: string, cls: PLCVariable['class']): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: 'BOOL' },
  location: '',
  documentation: '',
})

const externals = pouExternalNames([
  variable('g_plant', 'external'),
  variable('lp', 'local'),
  variable('Run', 'external'),
])

describe('pouExternalNames', () => {
  it('maps the upper-case name of each VAR_EXTERNAL to its declared name and skips other classes', () => {
    expect([...externals]).toEqual([
      ['G_PLANT', 'g_plant'],
      ['RUN', 'Run'],
    ])
  })
})

describe('pouDebugKey', () => {
  it('keys a local name under the POU scope', () => {
    expect(pouDebugKey('lp.LINES[1].MOTORS[1].RUNNING', 'ldarr:', externals)).toBe(
      'ldarr:lp.LINES[1].MOTORS[1].RUNNING',
    )
  })

  it('keys a global referenced through VAR_EXTERNAL under the canonical configuration key, with its member path', () => {
    expect(pouDebugKey('Run', 'ldarr:', externals)).toBe('Config0:Run')
    expect(pouDebugKey('g_plant.LINES[2].MOTORS[1].RUNNING', 'ldarr:', externals)).toBe(
      'Config0:g_plant.LINES[2].MOTORS[1].RUNNING',
    )
  })

  it('matches the external case-insensitively and keys it by its declared name', () => {
    expect(pouDebugKey('RUN', 'main:', externals)).toBe('Config0:Run')
    expect(pouDebugKey('G_PLANT[3]', 'main:', externals)).toBe('Config0:g_plant[3]')
  })

  it('keeps the function block instance scope for locals and ignores names that only start like an external', () => {
    expect(pouDebugKey('Running', 'main:fb1.', externals)).toBe('main:fb1.Running')
    expect(pouDebugKey('_TMP_AND7_OUT', 'main:', externals)).toBe('main:_TMP_AND7_OUT')
  })
})

describe('pouDebugExpressions', () => {
  it('returns each expression of the POU scope and of its externals with the key holding its value', () => {
    const keys = ['ldarr:lp.ID', 'Config0:g_plant.ID', 'Config0:other_global', 'main:x', 'ldarr:Run']
    expect(Object.fromEntries(pouDebugExpressions(keys, 'ldarr:', externals))).toEqual({
      'lp.ID': 'ldarr:lp.ID',
      'g_plant.ID': 'Config0:g_plant.ID',
      Run: 'ldarr:Run',
    })
  })
})
