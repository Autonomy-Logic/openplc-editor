import { parseHmiBuildSources } from '../build-sources-schema'
import { defaultHmiSettings } from '../settings'

const valid = {
  screens: [{ name: 'Overview', source: 'FUNCTION_BLOCK Overview EXTENDS HmiScreen\nEND_FUNCTION_BLOCK\n' }],
  widgets: [],
  settings: defaultHmiSettings(),
  plcVariables: [{ path: 'instance0.Main.Level', type: 'REAL', constant: true }],
  plcDeclarations: 'PROGRAM Main\nEND_PROGRAM\n',
  projectNames: ['Main'],
}

describe('parseHmiBuildSources', () => {
  it('passes valid sources through', () => {
    expect(parseHmiBuildSources(valid)).toEqual({ ok: true, hmi: valid })
  })

  it('reads null and undefined as a project without screens', () => {
    expect(parseHmiBuildSources(null)).toEqual({ ok: true, hmi: null })
    expect(parseHmiBuildSources(undefined)).toEqual({ ok: true, hmi: null })
  })

  it.each([
    ['a string', 'screens'],
    ['a screen without source', { ...valid, screens: [{ name: 'X' }] }],
    ['a variable marked constant false', { ...valid, plcVariables: [{ path: 'a', type: 'BOOL', constant: false }] }],
    ['project names that are not strings', { ...valid, projectNames: [1] }],
  ])('refuses %s, naming the field', (_what, value) => {
    const result = parseHmiBuildSources(value)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })
})
