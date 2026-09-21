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

  it('ignores pins with no alias at all', () => {
    seedPins([{ address: '%QX0.0' }, { address: '%QX0.1', alias: '' }])
    expect(getState().projectActions.normalizeProjectAliases().repairs).toEqual([])
  })
})
