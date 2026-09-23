import { ARDUINO_CLI_CAPABILITIES, RUNTIME_V4_CAPABILITIES } from '../../target-capabilities'
import { buildAddressPool } from '../address-pool'
import {
  buildAliasRegistry,
  describeAliasRejection,
  isAliasConflict,
  isAliasNameAvailable,
  resolveAlias,
  validateAliasEdit,
  validateAliasName,
} from '../alias-registry'

const v4 = RUNTIME_V4_CAPABILITIES
const arduino = ARDUINO_CLI_CAPABILITIES
const v4WithVpp = { ...v4, vppIo: true }

describe('buildAliasRegistry', () => {
  it('returns empty maps when the pool has no aliased claims', () => {
    const pool = buildAddressPool(
      {
        remoteDevices: [
          { name: 'd', modbusTcpConfig: { ioGroups: [{ ioPoints: [{ id: 'p', iecLocation: '%MW1' }] }] } },
        ],
      },
      v4,
    )
    const reg = buildAliasRegistry(pool)
    expect(reg.byAlias.size).toBe(0)
    expect(reg.duplicateAliases).toEqual([])
  })

  it('indexes every aliased claim by alias name', () => {
    const pool = buildAddressPool(
      {
        vendorIoMapping: {
          entries: [
            { iecAddress: '%QX0.5', alias: 'conveyor_motor', slot: 1, channelName: 'DO1' },
            { iecAddress: '%IW2', alias: 'tank_level', slot: 2, channelName: 'AI1' },
            // No alias — should not appear in the registry.
            { iecAddress: '%QW3', slot: 3, channelName: 'AO1' },
          ],
        },
      },
      v4WithVpp,
    )
    const reg = buildAliasRegistry(pool)
    expect(reg.byAlias.size).toBe(2)
    expect(reg.byAlias.get('conveyor_motor')?.address).toBe('%QX0.5')
    expect(reg.byAlias.get('tank_level')?.address).toBe('%IW2')
    // The un-aliased claim (%QW3) is absent from the index.
    expect([...reg.byAlias.values()].some((e) => e.address === '%QW3')).toBe(false)
  })

  it('records duplicate alias names; first encounter wins in byAlias', () => {
    // Two different addresses both labelled "valve" — one from pin
    // mapping, one from a Modbus remote device.
    const pool = buildAddressPool(
      {
        pinMapping: { pins: [{ address: '%QX0.0', alias: 'valve' }] },
        remoteDevices: [
          {
            name: 'd',
            modbusTcpConfig: {
              ioGroups: [{ ioPoints: [{ id: 'p', iecLocation: '%MW1', alias: 'valve' }] }],
            },
          },
        ],
      },
      { ...arduino, modbusTcpRemote: true },
    )
    const reg = buildAliasRegistry(pool)
    // Pool's reservation pass runs pin-mapping first; that's who wins.
    expect(reg.byAlias.get('valve')?.address).toBe('%QX0.0')
    expect(reg.duplicateAliases).toEqual(['valve'])
  })

  it('records each duplicate alias once even when three producers collide', () => {
    const pool = buildAddressPool(
      {
        vendorIoMapping: {
          entries: [{ iecAddress: '%IW0', alias: 'shared', slot: 1, channelName: 'AI1' }],
        },
        remoteDevices: [
          {
            name: 'd1',
            modbusTcpConfig: {
              ioGroups: [{ ioPoints: [{ id: 'p', iecLocation: '%MW2', alias: 'shared' }] }],
            },
            ethercatConfig: {
              devices: [
                {
                  name: 's',
                  channelMappings: [{ channelId: 'c', iecLocation: '%MW3', alias: 'shared' }],
                },
              ],
            },
          },
        ],
      },
      v4WithVpp,
    )
    const reg = buildAliasRegistry(pool)
    expect(reg.duplicateAliases).toEqual(['shared'])
    expect(reg.byAlias.get('shared')?.source.kind).toBe('vpp-io')
  })

  it('respects target scoping: aliases on inactive producers do not appear', () => {
    // Same project data — Arduino-target view skips VPP and Modbus
    // remote aliases.
    const inputs = {
      vendorIoMapping: {
        entries: [{ iecAddress: '%IW0', alias: 'vpp_alias', slot: 1, channelName: 'AI1' }],
      },
      pinMapping: { pins: [{ address: '%QX0.0', alias: 'pin_alias' }] },
    }
    const arduinoPool = buildAddressPool(inputs, arduino)
    const v4Pool = buildAddressPool(inputs, v4WithVpp)
    expect(buildAliasRegistry(arduinoPool).byAlias.size).toBe(1)
    expect(buildAliasRegistry(arduinoPool).byAlias.has('pin_alias')).toBe(true)
    expect(buildAliasRegistry(v4Pool).byAlias.size).toBe(1)
    expect(buildAliasRegistry(v4Pool).byAlias.has('vpp_alias')).toBe(true)
  })
})

describe('resolveAlias', () => {
  const pool = buildAddressPool(
    {
      vendorIoMapping: {
        entries: [{ iecAddress: '%QX1.0', alias: 'conveyor_motor', slot: 1, channelName: 'DO1' }],
      },
    },
    v4WithVpp,
  )
  const reg = buildAliasRegistry(pool)

  it('returns the current address for a known alias', () => {
    expect(resolveAlias(reg, 'conveyor_motor')).toBe('%QX1.0')
  })

  it('returns undefined for an unknown alias (variable would be orphaned)', () => {
    expect(resolveAlias(reg, 'missing_alias')).toBeUndefined()
  })
})

describe('isAliasNameAvailable', () => {
  const pool = buildAddressPool(
    {
      vendorIoMapping: {
        entries: [{ iecAddress: '%IW0', alias: 'tank', slot: 1, channelName: 'AI1' }],
      },
    },
    v4WithVpp,
  )
  const reg = buildAliasRegistry(pool)

  it('returns true for an unused alias name', () => {
    expect(isAliasNameAvailable(reg, 'brand_new')).toBe(true)
  })

  it('returns false for an alias already declared by some producer', () => {
    expect(isAliasNameAvailable(reg, 'tank')).toBe(false)
  })

  it('returns true when the existing entry belongs to the source we are ignoring (rename within self)', () => {
    expect(isAliasNameAvailable(reg, 'tank', { kind: 'vpp-io', ref: 'slot-1:AI1' })).toBe(true)
  })

  it('returns false when ignoring a different source', () => {
    expect(isAliasNameAvailable(reg, 'tank', { kind: 'modbus-tcp-remote', ref: 'd:p' })).toBe(false)
  })
})

describe('validateAliasEdit', () => {
  const pool = buildAddressPool(
    {
      vendorIoMapping: {
        entries: [{ iecAddress: '%IW0', alias: 'tank', slot: 1, channelName: 'AI1' }],
      },
    },
    v4WithVpp,
  )
  const reg = buildAliasRegistry(pool)

  it('accepts an empty alias (user clearing the field)', () => {
    expect(validateAliasEdit(reg, '', { kind: 'vpp-io', ref: 'slot-2:AI1' })).toEqual({ ok: true })
    expect(validateAliasEdit(reg, '   ', { kind: 'vpp-io', ref: 'slot-2:AI1' })).toEqual({ ok: true })
    expect(validateAliasEdit(reg, undefined, { kind: 'vpp-io', ref: 'slot-2:AI1' })).toEqual({ ok: true })
  })

  it('accepts a brand-new alias name', () => {
    expect(validateAliasEdit(reg, 'pressure', { kind: 'vpp-io', ref: 'slot-2:AI1' })).toEqual({ ok: true })
  })

  it('accepts a no-op rename (same alias, same source)', () => {
    expect(validateAliasEdit(reg, 'tank', { kind: 'vpp-io', ref: 'slot-1:AI1' })).toEqual({ ok: true })
  })

  it('rejects a collision with another channel and returns the conflicting entry', () => {
    const result = validateAliasEdit(reg, 'tank', { kind: 'vpp-io', ref: 'slot-2:AI1' })
    expect(result.ok).toBe(false)
    if (isAliasConflict(result)) {
      expect(result.conflict.alias).toBe('tank')
      expect(result.conflict.address).toBe('%IW0')
      expect(result.conflict.source).toEqual({ kind: 'vpp-io', ref: 'slot-1:AI1' })
    }
  })

  it('rejects a collision across producers (pin-mapping vs VPP)', () => {
    const result = validateAliasEdit(reg, 'tank', { kind: 'pin-mapping', ref: '%QX0.0' })
    expect(result.ok).toBe(false)
  })
})

describe('an alias has to be an IEC identifier (DOPE-650)', () => {
  const taken = buildAliasRegistry(
    buildAddressPool(
      { vendorIoMapping: { entries: [{ iecAddress: '%IW0', alias: 'tank', slot: 1, channelName: 'AI1' }] } },
      v4WithVpp,
    ),
  )
  const empty = buildAliasRegistry(buildAddressPool({}, v4WithVpp))
  const anywhere = { kind: 'vpp-io' as const, ref: 'slot-9:AI9' }

  it('accepts a plain identifier', () => {
    expect(validateAliasName('Motor_Start')).toEqual({ ok: true })
  })

  it.each([
    ['a space', 'Motor Start'],
    ['a hyphen', 'relay-1'],
    ['a leading digit', '1st_relay'],
    ['punctuation', 'relay#1'],
  ])('refuses %s', (_label, alias) => {
    const result = validateAliasName(alias)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(alias)
  })

  it('refuses a reserved word, which would collide with the language', () => {
    expect(validateAliasName('VAR').ok).toBe(false)
  })

  it('refuses a %% location, which is the other thing the field can hold', () => {
    expect(validateAliasName('%QX0.0').ok).toBe(false)
  })

  // Which words are reserved is the parser's to say, and it says fewer than the
  // editor's identifier list did. That list also holds every standard function
  // name, so an existing pin called `Max` or `Step` was renamed on open although
  // STruC++ reads either one as an `AT` operand perfectly well.
  it.each(['Max', 'Min', 'Step', 'TP', 'Left', 'Time', 'Limit', 'Move', 'Abs', 'Sel', 'Mux'])(
    'accepts %s, which STruC++ reads as an AT operand',
    (alias) => {
      expect(validateAliasName(alias)).toEqual({ ok: true })
    },
  )

  it.each(['SET', 'Set', 'VAR', 'IF', 'THEN', 'ARRAY'])('still refuses %s, which it does not', (alias) => {
    expect(validateAliasName(alias).ok).toBe(false)
  })

  it('refuses a name that would smuggle a second declaration in', () => {
    // The operand is spliced into the file verbatim, so the check is that it
    // reads back as ONE thing.
    expect(validateAliasName('a; b : INT').ok).toBe(false)
  })

  it('rejects a malformed name through validateAliasEdit, before any collision check', () => {
    // The shape is wrong whether or not the name is taken, and "already in use"
    // would be a confusing thing to say about `Motor Start`.
    const result = validateAliasEdit(empty, 'Motor Start', anywhere)
    expect(result.ok).toBe(false)
    expect(isAliasConflict(result)).toBe(false)
  })

  it('still lets an empty alias through — clearing one is how a channel is unnamed', () => {
    expect(validateAliasEdit(empty, '', anywhere)).toEqual({ ok: true })
  })

  it('describes the two refusals differently', () => {
    const malformed = validateAliasEdit(empty, 'Motor Start', anywhere)
    expect(malformed.ok).toBe(false)
    if (malformed.ok) return
    expect(describeAliasRejection(malformed, 'Motor Start').title).toBe('Alias name is invalid')

    const collision = validateAliasEdit(taken, 'tank', { kind: 'vpp-io', ref: 'slot-2:AI1' })
    expect(collision.ok).toBe(false)
    if (collision.ok) return
    expect(describeAliasRejection(collision, 'tank').title).toBe('Alias already in use')
  })
})
