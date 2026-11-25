import type { PLCProjectData } from '../../../../middleware/shared/ports/types'
import { defaultHmiSettings } from '../../../../middleware/shared/utils/hmi/settings'
import { hmiBuildSources } from '../hmi-build-sources'

const SCREEN = { name: 'Overview', source: 'FUNCTION_BLOCK Overview EXTENDS HmiScreen\nEND_FUNCTION_BLOCK\n' }

function project(hmi: PLCProjectData['hmi']): PLCProjectData {
  return {
    dataTypes: [],
    pous: [],
    configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    hmi,
  }
}

describe('hmiBuildSources', () => {
  it('is null for a project without screens', () => {
    expect(hmiBuildSources(project(undefined))).toBeNull()
    expect(hmiBuildSources(project({ screens: [], widgets: [], settings: defaultHmiSettings() }))).toBeNull()
  })

  it('carries the screens, widget blocks, settings and what screens may refer to', () => {
    const settings = defaultHmiSettings()
    const sources = hmiBuildSources(project({ screens: [SCREEN], widgets: [], settings }))
    expect(sources).toEqual({
      screens: [SCREEN],
      widgets: [],
      settings,
      plcVariables: [],
      plcDeclarations: expect.any(String),
      projectNames: [],
    })
  })
})
