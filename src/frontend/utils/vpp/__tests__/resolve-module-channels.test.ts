import { resolveModuleChannels, type ResolverModuleDef } from '../resolve-module-channels'

const rawChannels = [{ name: 'AI1', type: 'analogInput', dataType: 'UINT', addressPrefix: '%IW' }]
const euChannels = [{ name: 'AI1', type: 'analogInput', dataType: 'REAL', addressPrefix: '%ID' }]

describe('resolveModuleChannels', () => {
  it('returns the static channels array when no format mechanism is declared', () => {
    const md: ResolverModuleDef = { addressMapping: { channels: rawChannels } }
    expect(resolveModuleChannels(md, {})).toEqual(rawChannels)
  })

  it('returns the array keyed by the slot field value', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        formatFieldId: 'data_format',
        formatDefault: 'raw',
        channelsByFormat: { raw: rawChannels, engineering: euChannels },
      },
    }
    expect(resolveModuleChannels(md, { data_format: 'engineering' })).toEqual(euChannels)
  })

  it('falls back to formatDefault when the slot has not set the format field yet', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        formatFieldId: 'data_format',
        formatDefault: 'raw',
        channelsByFormat: { raw: rawChannels, engineering: euChannels },
      },
    }
    expect(resolveModuleChannels(md, {})).toEqual(rawChannels)
    expect(resolveModuleChannels(md, undefined)).toEqual(rawChannels)
  })

  it('falls back to legacy channels array when channelsByFormat does not contain the resolved key', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        formatFieldId: 'data_format',
        formatDefault: 'raw',
        channelsByFormat: { engineering: euChannels },
        channels: rawChannels,
      },
    }
    // formatDefault=raw but channelsByFormat.raw is missing — fall through.
    expect(resolveModuleChannels(md, {})).toEqual(rawChannels)
  })

  it('returns an empty array when the module has no addressMapping', () => {
    expect(resolveModuleChannels({}, {})).toEqual([])
    expect(resolveModuleChannels(undefined, {})).toEqual([])
  })

  it('coerces non-string slot values to strings before lookup', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        formatFieldId: 'mode',
        channelsByFormat: { '0': rawChannels, '1': euChannels },
      },
    }
    expect(resolveModuleChannels(md, { mode: 1 })).toEqual(euChannels)
  })

  // ---------------------------------------------------------------
  // perChannelChoices — Arduino Opta-style per-pin mode selection
  // ---------------------------------------------------------------

  const boolPin1 = { name: 'I1', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' }
  const analogPin1 = { name: 'I1', type: 'analogInput', dataType: 'UINT', addressPrefix: '%IW' }
  const boolPin2 = { name: 'I2', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' }
  const analogPin2 = { name: 'I2', type: 'analogInput', dataType: 'UINT', addressPrefix: '%IW' }
  const staticRelay = { name: 'O1', type: 'digitalOutput', dataType: 'BOOL', addressPrefix: '%QX' }

  // Channels resolved via perChannelChoices carry the originating
  // fieldId + the set of mode keys + the currently-selected mode key
  // so the IO Table can render a per-row mode selector that mutates
  // the same slotsConfig field. Use this helper to add the expected
  // augmentation to a raw channel literal.
  const withMode = (
    channel: { name: string; type: string; dataType: string; addressPrefix: string },
    fieldId: string,
    modeKeys: string[],
    value: string,
  ) => ({ ...channel, modeFieldId: fieldId, modeOptions: modeKeys, modeValue: value })

  it('emits per-channel-resolved channels in declaration order', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        perChannelChoices: [
          { fieldId: 'i1_mode', default: 'bool', modes: { bool: boolPin1, analog: analogPin1 } },
          { fieldId: 'i2_mode', default: 'bool', modes: { bool: boolPin2, analog: analogPin2 } },
        ],
      },
    }
    expect(resolveModuleChannels(md, { i1_mode: 'analog', i2_mode: 'bool' })).toEqual([
      withMode(analogPin1, 'i1_mode', ['bool', 'analog'], 'analog'),
      withMode(boolPin2, 'i2_mode', ['bool', 'analog'], 'bool'),
    ])
  })

  it('appends per-channel-resolved channels after the static channels (relays/LEDs/button)', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        channels: [staticRelay],
        perChannelChoices: [{ fieldId: 'i1_mode', default: 'bool', modes: { bool: boolPin1, analog: analogPin1 } }],
      },
    }
    expect(resolveModuleChannels(md, { i1_mode: 'analog' })).toEqual([
      staticRelay,
      withMode(analogPin1, 'i1_mode', ['bool', 'analog'], 'analog'),
    ])
  })

  it('uses the per-channel `default` when the slot has not set the field', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        perChannelChoices: [{ fieldId: 'i1_mode', default: 'analog', modes: { bool: boolPin1, analog: analogPin1 } }],
      },
    }
    expect(resolveModuleChannels(md, {})).toEqual([withMode(analogPin1, 'i1_mode', ['bool', 'analog'], 'analog')])
    expect(resolveModuleChannels(md, undefined)).toEqual([
      withMode(analogPin1, 'i1_mode', ['bool', 'analog'], 'analog'),
    ])
  })

  it('drops a per-channel entry whose mode maps to null (disabled mode)', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        perChannelChoices: [
          { fieldId: 'i1_mode', default: 'off', modes: { off: null, bool: boolPin1 } },
          { fieldId: 'i2_mode', default: 'bool', modes: { bool: boolPin2 } },
        ],
      },
    }
    expect(resolveModuleChannels(md, {})).toEqual([withMode(boolPin2, 'i2_mode', ['bool'], 'bool')])
  })

  it('drops a per-channel entry whose mode is not in the modes map (unknown value)', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        perChannelChoices: [{ fieldId: 'i1_mode', default: 'bool', modes: { bool: boolPin1 } }],
      },
    }
    expect(resolveModuleChannels(md, { i1_mode: 'banana' })).toEqual([])
  })

  it('drops a per-channel entry with no default + no slot value', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        perChannelChoices: [{ fieldId: 'i1_mode', modes: { bool: boolPin1 } }],
      },
    }
    expect(resolveModuleChannels(md, {})).toEqual([])
  })

  it('module-wide channelsByFormat short-circuits before perChannelChoices', () => {
    const md: ResolverModuleDef = {
      addressMapping: {
        formatFieldId: 'data_format',
        formatDefault: 'raw',
        channelsByFormat: { raw: rawChannels, engineering: euChannels },
        // perChannelChoices declared too — should be ignored when channelsByFormat matches.
        perChannelChoices: [{ fieldId: 'i1_mode', default: 'bool', modes: { bool: boolPin1 } }],
      },
    }
    expect(resolveModuleChannels(md, { data_format: 'engineering', i1_mode: 'bool' })).toEqual(euChannels)
  })
})
