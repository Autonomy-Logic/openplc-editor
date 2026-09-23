/**
 * Repairing aliases saved before they had to be IEC identifiers (DOPE-650).
 *
 * `AT <alias>` is read back by STruC++ as an identifier, so a project carrying
 * `Motor Start` cannot be re-read. The editor accepted such names before the
 * rule existed, so those projects are real and are repaired on load.
 *
 * Renamed, never dropped: a variable bound to a deleted alias resolves to
 * unlocated at compile time, which is a silent wrong answer.
 */
import { parseProjectFiles } from '../../../backend/shared/utils/parse-project-files'
import { useOpenPLCStore } from '../index'

const getState = () => useOpenPLCStore.getState()

const seedPins = (pins: Array<{ address: string; alias?: string }>) => {
  getState().deviceActions.setDeviceDefinitions({
    configuration: { deviceBoard: 'TestBoard' },
    pinMapping: pins.map((pin, index) => ({ pin: String(index), pinType: 'digitalOutput', ...pin })),
  })
}

const seedPouWithLocation = (name: string, location: string) => {
  expect(getState().pouActions.create({ type: 'program', name, language: 'st' }).ok).toBe(true)
  getState().projectActions.setPouVariables({
    pouName: name,
    variables: [
      {
        name: 'bound',
        class: 'local',
        type: { definition: 'base-type', value: 'BOOL' },
        location,
        documentation: '',
        debug: false,
      },
    ],
  })
}

const locationOf = (pouName: string) =>
  getState().project.data.pous.find((pou) => pou.name === pouName)?.interface?.variables[0].location

const aliasesOf = () => (getState().deviceDefinitions.pinMapping.pinsByBoard['TestBoard'] ?? []).map((pin) => pin.alias)

describe('normalizeProjectAliases', () => {
  beforeEach(() => {
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  })

  it('leaves a project whose aliases are already legal untouched', () => {
    seedPins([{ address: '%QX0.0', alias: 'Motor_Start' }])
    expect(getState().projectActions.normalizeProjectAliases().repairs).toEqual([])
    expect(aliasesOf()).toEqual(['Motor_Start'])
  })

  it('renames an alias containing a space and reports it', () => {
    seedPins([{ address: '%QX0.0', alias: 'Motor Start' }])
    const { repairs } = getState().projectActions.normalizeProjectAliases()

    expect(repairs.map((repair) => [repair.from, repair.to])).toEqual([['Motor Start', 'Motor_Start']])
    expect(aliasesOf()).toEqual(['Motor_Start'])
  })

  it('cascades onto a variable bound to the old alias, so it stays located', () => {
    // Dropping the alias instead would leave `bound` pointing at a name no
    // producer declares — unlocated at compile time with nothing to show.
    seedPins([{ address: '%QX0.0', alias: 'Motor Start' }])
    seedPouWithLocation('Main', 'Motor Start')

    getState().projectActions.normalizeProjectAliases()

    expect(locationOf('Main')).toBe('Motor_Start')
  })

  it('leaves a manual literal location alone', () => {
    seedPins([{ address: '%QX0.0', alias: 'Motor Start' }])
    seedPouWithLocation('ManualBound', '%QX0.1')

    getState().projectActions.normalizeProjectAliases()

    expect(locationOf('ManualBound')).toBe('%QX0.1')
  })

  it('does not collide a repaired alias with one that is already legal', () => {
    seedPins([
      { address: '%QX0.0', alias: 'Motor_Start' },
      { address: '%QX0.1', alias: 'Motor Start' },
    ])
    getState().projectActions.normalizeProjectAliases()

    expect(aliasesOf()).toEqual(['Motor_Start', 'Motor_Start2'])
  })

  it('repairs several aliases in one pass', () => {
    seedPins([
      { address: '%QX0.0', alias: 'Motor Start' },
      { address: '%QX0.1', alias: 'relay-1' },
    ])
    const { repairs } = getState().projectActions.normalizeProjectAliases()

    expect(repairs).toHaveLength(2)
    expect(aliasesOf()).toEqual(['Motor_Start', 'relay_1'])
  })

  it('gives two producers sharing one illegal alias a name each', () => {
    // The plan deliberately hands out `Motor_Start` and `Motor_Start2` so the
    // two do not end up sharing a name again. Keying the replacements by the
    // old name collapsed them: both pins became `Motor_Start2` — a duplicate
    // alias, which the registry then resolves first-wins, silently shadowing
    // one pin.
    seedPins([
      { address: '%QX0.0', alias: 'Motor Start' },
      { address: '%QX0.1', alias: 'Motor Start' },
    ])
    getState().projectActions.normalizeProjectAliases()

    expect(aliasesOf()).toEqual(['Motor_Start', 'Motor_Start2'])
  })

  it('keeps a variable bound to a shared illegal alias on a name a producer holds', () => {
    // The variable cannot say which of the two it meant, so it follows the
    // first — the same first-wins rule the registry resolves duplicates by.
    // Cascading the second rename afterwards moved it onto a name neither pin
    // held any more, leaving it orphaned with nothing reported.
    seedPins([
      { address: '%QX0.0', alias: 'Motor Start' },
      { address: '%QX0.1', alias: 'Motor Start' },
    ])
    seedPouWithLocation('Shared', 'Motor Start')

    getState().projectActions.normalizeProjectAliases()

    expect(locationOf('Shared')).toBe('Motor_Start')
    expect(aliasesOf()).toContain('Motor_Start')
  })

  it('ignores pins with no alias at all', () => {
    seedPins([{ address: '%QX0.0' }, { address: '%QX0.1', alias: '' }])
    expect(getState().projectActions.normalizeProjectAliases().repairs).toEqual([])
  })
})

/**
 * What a repair leaves behind for the user to save.
 *
 * The repair rewrites memory only. Nothing was marked unsaved, so the project
 * could sit there repaired and unsaved, and saving ONE file — the device tab on
 * its own — wrote the new alias to the pin mapping while the POU kept
 * `AT Motor Start`. On the next open there is nothing left to repair from: the
 * binding is simply orphaned.
 */
describe('a repaired project is marked unsaved', () => {
  const PROJECT_JSON = JSON.stringify({
    meta: { name: 'P', type: 'plc-project' },
    data: { dataTypes: [], pous: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
  })

  const openWith = (alias: string, declarations: string) => {
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
    const parsed = parseProjectFiles(
      '/p',
      PROJECT_JSON,
      JSON.stringify({ deviceBoard: 'uno', communicationPort: '', compileOnly: false }),
      JSON.stringify([{ pin: '0', pinType: 'digitalOutput', address: '%QX0.0', alias }]),
      [{ relativePath: 'pous/programs/main.st', content: `PROGRAM main\n${declarations}\n\n;\n\nEND_PROGRAM` }],
      [],
      [],
    )
    getState().sharedWorkspaceActions.handleOpenProjectResponse(parsed)
  }

  const allSaved = () => Object.values(getState().files).every((file) => file.saved)

  it('marks everything unsaved when it repairs an alias', () => {
    openWith('Motor Start', 'VAR\n  bound : BOOL AT Motor Start;\nEND_VAR')

    expect(allSaved()).toBe(false)
  })

  it('leaves a project it did not touch saved', () => {
    openWith('Motor_Start', 'VAR\n  bound : BOOL AT Motor_Start;\nEND_VAR')

    expect(allSaved()).toBe(true)
  })
})
