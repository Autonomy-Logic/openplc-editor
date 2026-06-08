import { RUNTIME_V4_CAPABILITIES } from '../../target-capabilities'
import { buildAddressPool } from '../address-pool'
import { buildAliasRegistry } from '../alias-registry'
import { syncMadeChanges, syncVariableAliases, type SyncableVariable } from '../sync-variable-aliases'

const vppCaps = { ...RUNTIME_V4_CAPABILITIES, vppIo: true }

function buildRegistryFromVpp(
  entries: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }>,
) {
  const pool = buildAddressPool({ vendorIoMapping: { entries } }, vppCaps)
  return buildAliasRegistry(pool)
}

const VAR = (overrides: Partial<SyncableVariable>): SyncableVariable => ({
  name: 'v',
  location: '',
  ...overrides,
})

describe('syncVariableAliases', () => {
  it('returns variables unchanged and an empty report when none have aliases or matching addresses', () => {
    const registry = buildRegistryFromVpp([])
    const vars = [VAR({ name: 'x', location: '%IW0' })]
    const result = syncVariableAliases(vars, registry)
    expect(result.variables).toEqual(vars)
    expect(result.report.adopted).toEqual([])
    expect(result.report.refreshed).toEqual([])
    expect(result.report.orphaned).toEqual([])
  })

  it("adopts an alias when a variable's location matches a registry entry (self-upgrade)", () => {
    const registry = buildRegistryFromVpp([
      { iecAddress: '%QX0.0', alias: 'conveyor_motor', slot: 1, channelName: 'DO1' },
    ])
    const vars = [VAR({ name: 'motor', location: '%QX0.0' })]
    const result = syncVariableAliases(vars, registry)
    expect(result.variables[0].alias).toBe('conveyor_motor')
    expect(result.variables[0].location).toBe('%QX0.0')
    expect(result.report.adopted).toEqual([{ varName: 'motor', alias: 'conveyor_motor', address: '%QX0.0' }])
  })

  it('refreshes location when the alias has moved to a new address', () => {
    const registry = buildRegistryFromVpp([
      { iecAddress: '%QX1.5', alias: 'conveyor_motor', slot: 3, channelName: 'DO1' },
    ])
    const vars = [VAR({ name: 'motor', location: '%QX0.0', alias: 'conveyor_motor' })]
    const result = syncVariableAliases(vars, registry)
    expect(result.variables[0].location).toBe('%QX1.5')
    expect(result.variables[0].alias).toBe('conveyor_motor')
    expect(result.report.refreshed).toEqual([
      { varName: 'motor', alias: 'conveyor_motor', oldAddress: '%QX0.0', newAddress: '%QX1.5' },
    ])
  })

  it('leaves location and alias intact when the alias is still bound to the same address', () => {
    const registry = buildRegistryFromVpp([{ iecAddress: '%IW3', alias: 'tank_level', slot: 2, channelName: 'AI1' }])
    const vars = [VAR({ name: 'tank', location: '%IW3', alias: 'tank_level' })]
    const result = syncVariableAliases(vars, registry)
    expect(result.variables).toEqual(vars)
    expect(result.report.refreshed).toEqual([])
  })

  it('reports orphaned variables when the alias no longer exists in the registry', () => {
    const registry = buildRegistryFromVpp([])
    const vars = [VAR({ name: 'ghost', location: '%QX2.0', alias: 'removed_module' })]
    const result = syncVariableAliases(vars, registry)
    // Variable kept as-is so the user can re-bind manually.
    expect(result.variables[0].location).toBe('%QX2.0')
    expect(result.variables[0].alias).toBe('removed_module')
    expect(result.report.orphaned).toEqual([{ varName: 'ghost', alias: 'removed_module', lastKnownAddress: '%QX2.0' }])
    expect(result.report.adopted).toEqual([])
    expect(result.report.refreshed).toEqual([])
  })

  it('handles a mix of adopted, refreshed, orphaned, and untouched variables in one pass', () => {
    const registry = buildRegistryFromVpp([
      { iecAddress: '%IW1', alias: 'pressure', slot: 1, channelName: 'AI1' },
      { iecAddress: '%QX3.2', alias: 'valve_open', slot: 2, channelName: 'DO1' },
    ])
    const vars: SyncableVariable[] = [
      VAR({ name: 'adopted', location: '%IW1' }),
      VAR({ name: 'refreshed', location: '%QX0.0', alias: 'valve_open' }),
      VAR({ name: 'orphaned', location: '%QW9', alias: 'gone' }),
      VAR({ name: 'untouched', location: '%MW100' }),
    ]
    const result = syncVariableAliases(vars, registry)
    expect(result.variables[0]).toMatchObject({ name: 'adopted', alias: 'pressure', location: '%IW1' })
    expect(result.variables[1]).toMatchObject({ name: 'refreshed', alias: 'valve_open', location: '%QX3.2' })
    expect(result.variables[2]).toMatchObject({ name: 'orphaned', alias: 'gone', location: '%QW9' })
    expect(result.variables[3]).toMatchObject({ name: 'untouched', location: '%MW100' })

    expect(result.report.adopted).toHaveLength(1)
    expect(result.report.refreshed).toHaveLength(1)
    expect(result.report.orphaned).toHaveLength(1)
  })

  it('refresh is producer-agnostic: alias name wins over IEC address for VPP, Modbus, and EtherCAT alike', () => {
    // The registry/sync layer doesn't care which producer staked a
    // claim — `byAlias` is a flat name->address map. If the alias
    // moves, every variable bound to that name follows. Build one
    // registry seeded from all three producer kinds and verify a
    // refresh fires for each.
    const pool = buildAddressPool(
      {
        // VPP: alias "tank_level" relocated from %IW2 to %IW10.
        vendorIoMapping: {
          entries: [{ iecAddress: '%IW10', alias: 'tank_level', slot: 1, channelName: 'AI0' }],
        },
        remoteDevices: [
          {
            name: 'modbus-slave',
            // Modbus: alias "temp" relocated from %IW0 to %IW20.
            modbusTcpConfig: {
              ioGroups: [
                {
                  id: 'g1',
                  ioPoints: [{ id: 'p1', iecLocation: '%IW20', alias: 'temp' }],
                },
              ],
            },
          },
          {
            name: 'ec-master',
            // EtherCAT: alias "estop" relocated from %IX0.0 to %IX2.3.
            ethercatConfig: {
              devices: [
                {
                  name: 'coupler',
                  channelMappings: [{ channelId: 'ch-0', iecLocation: '%IX2.3', alias: 'estop' }],
                },
              ],
            },
          },
        ],
      },
      { ...RUNTIME_V4_CAPABILITIES, vppIo: true, modbusTcpRemote: true, ethercat: true },
    )
    const registry = buildAliasRegistry(pool)

    const vars: SyncableVariable[] = [
      VAR({ name: 'tank_level_var', location: '%IW2', alias: 'tank_level' }),
      VAR({ name: 'temperature', location: '%IW0', alias: 'temp' }),
      VAR({ name: 'estop_var', location: '%IX0.0', alias: 'estop' }),
    ]
    const result = syncVariableAliases(vars, registry)

    expect(result.variables[0]).toMatchObject({ name: 'tank_level_var', alias: 'tank_level', location: '%IW10' })
    expect(result.variables[1]).toMatchObject({ name: 'temperature', alias: 'temp', location: '%IW20' })
    expect(result.variables[2]).toMatchObject({ name: 'estop_var', alias: 'estop', location: '%IX2.3' })
    expect(result.report.refreshed).toHaveLength(3)
    expect(result.report.adopted).toEqual([])
    expect(result.report.orphaned).toEqual([])
  })

  it('preserves carry-through fields (type, class, etc.) on changed variables', () => {
    const registry = buildRegistryFromVpp([{ iecAddress: '%QX0.0', alias: 'motor', slot: 1, channelName: 'DO1' }])
    const vars = [
      {
        name: 'motor',
        location: '%QX0.0',
        type: { definition: 'base-type', value: 'BOOL' },
        class: 'local',
        documentation: '',
      } as SyncableVariable,
    ]
    const result = syncVariableAliases(vars, registry)
    expect(result.variables[0]).toMatchObject({
      alias: 'motor',
      type: { definition: 'base-type', value: 'BOOL' },
      class: 'local',
    })
  })
})

describe('syncMadeChanges', () => {
  it('returns true when adopted is non-empty', () => {
    expect(
      syncMadeChanges({ adopted: [{ varName: 'v', alias: 'a', address: 'x' }], refreshed: [], orphaned: [] }),
    ).toBe(true)
  })

  it('returns true when refreshed is non-empty', () => {
    expect(
      syncMadeChanges({
        adopted: [],
        refreshed: [{ varName: 'v', alias: 'a', oldAddress: 'x', newAddress: 'y' }],
        orphaned: [],
      }),
    ).toBe(true)
  })

  it('returns false when only orphans are reported (no state write needed)', () => {
    expect(
      syncMadeChanges({
        adopted: [],
        refreshed: [],
        orphaned: [{ varName: 'v', alias: 'a', lastKnownAddress: 'x' }],
      }),
    ).toBe(false)
  })

  it('returns false when nothing happened', () => {
    expect(syncMadeChanges({ adopted: [], refreshed: [], orphaned: [] })).toBe(false)
  })
})
