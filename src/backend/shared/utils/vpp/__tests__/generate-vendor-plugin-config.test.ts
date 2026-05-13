import {
  generateVendorPluginConfig,
  type VendorScreenData,
  type VppModuleDefinition,
} from '../generate-vendor-plugin-config'

const moduleDi8 = {
  id: 'di-8',
  name: 'DI-8',
  hwId: '0xDEADBEEF',
  addressMapping: {
    channels: [
      { name: 'I0', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' },
      { name: 'I1', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' },
    ],
  },
} satisfies VppModuleDefinition

const moduleAi4 = {
  id: 'ai-4',
  name: 'AI-4',
  hwId: '0xCAFEBABE',
  addressMapping: {
    channels: [
      { name: 'A0', type: 'analogInput', dataType: 'INT', addressPrefix: '%IW' },
      { name: 'A1', type: 'analogInput', dataType: 'INT', addressPrefix: '%IW' },
    ],
  },
} satisfies VppModuleDefinition

describe('generateVendorPluginConfig', () => {
  it('preserves all fields from the config template', () => {
    const template = { plugin_name: 'acme', baud_rate: 115200, nested: { x: 1 } }
    const result = generateVendorPluginConfig(template, {}, [])
    expect(result.plugin_name).toBe('acme')
    expect(result.baud_rate).toBe(115200)
    expect(result.nested).toEqual({ x: 1 })
  })

  it('merges form-shape vendor data at the root level', () => {
    const result = generateVendorPluginConfig(
      { plugin_name: 'acme' },
      { 'hal-config': { interface: 'eth0', frequency: 1000 } },
      [],
    )
    expect(result.interface).toBe('eth0')
    expect(result.frequency).toBe(1000)
    expect(result.plugin_name).toBe('acme')
  })

  it('skips reserved keys (module-configuration, io-mapping) when merging at root', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: [] },
      'io-mapping': { entries: [] },
    }
    const result = generateVendorPluginConfig({}, data, [])
    // The reserved keys must not appear at root — only `slots` does, and
    // it's the computed slots array, not the raw module-configuration.
    expect(Object.keys(result)).toEqual(['slots'])
    expect(result.slots).toEqual([])
  })

  it('skips non-object form values (arrays, primitives, null)', () => {
    const data: VendorScreenData = {
      'array-key': [1, 2, 3],
      'string-key': 'hello',
      'null-key': null,
      'good-key': { foo: 'bar' },
    }
    const result = generateVendorPluginConfig({}, data, [])
    expect(result.foo).toBe('bar')
    expect(result['array-key']).toBeUndefined()
    expect(result['string-key']).toBeUndefined()
    expect(result['null-key']).toBeUndefined()
  })

  it('always emits a slots array (empty when no slots are configured)', () => {
    const result = generateVendorPluginConfig({}, {}, [])
    expect(result.slots).toEqual([])
  })

  it('builds bit-range mapping for digital inputs from contiguous addresses', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: ['di-8'] },
      'io-mapping': {
        entries: [
          { slot: 1, channelName: 'I0', iecAddress: '%IX0.0', alias: '' },
          { slot: 1, channelName: 'I1', iecAddress: '%IX0.1', alias: '' },
        ],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleDi8])
    expect(result.slots).toEqual([
      {
        slot: 1,
        module_hw_id: '0xDEADBEEF',
        io_mapping: {
          digital_inputs: { base_byte: 0, base_bit: 0, count: 2 },
        },
      },
    ])
  })

  it('handles bit ranges that wrap across a byte boundary', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: ['di-8'] },
      'io-mapping': {
        entries: [
          { slot: 1, channelName: 'I0', iecAddress: '%IX0.7', alias: '' },
          { slot: 1, channelName: 'I1', iecAddress: '%IX1.0', alias: '' },
        ],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleDi8])
    const slot = (result.slots as Array<{ io_mapping: { digital_inputs: unknown } }>)[0]
    expect(slot.io_mapping.digital_inputs).toEqual({ base_byte: 0, base_bit: 7, count: 2 })
  })

  it('builds word-range mapping for analog inputs', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: ['ai-4'] },
      'io-mapping': {
        entries: [
          { slot: 1, channelName: 'A0', iecAddress: '%IW10', alias: '' },
          { slot: 1, channelName: 'A1', iecAddress: '%IW11', alias: '' },
        ],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleAi4])
    const slot = (result.slots as Array<{ io_mapping: { analog_inputs: unknown } }>)[0]
    expect(slot.io_mapping.analog_inputs).toEqual({ base_word: 10, count: 2 })
  })

  it('skips slots where the module id has no matching definition', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: ['unknown-module'] },
      'io-mapping': { entries: [] },
    }
    const result = generateVendorPluginConfig({}, data, [moduleDi8])
    expect(result.slots).toEqual([])
  })

  it('skips empty slot positions', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: [null, 'di-8', null] },
      'io-mapping': {
        entries: [{ slot: 2, channelName: 'I0', iecAddress: '%IX0.0', alias: '' }],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleDi8])
    expect(result.slots).toHaveLength(1)
    expect((result.slots as Array<{ slot: number }>)[0].slot).toBe(2)
  })

  it('omits module_hw_id when the module definition has no hwId', () => {
    const moduleNoHwId: VppModuleDefinition = {
      id: 'di-8-nohw',
      name: 'DI-8 (no hwId)',
      addressMapping: {
        channels: [{ name: 'I0', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' }],
      },
    }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['di-8-nohw'] },
      'io-mapping': {
        entries: [{ slot: 1, channelName: 'I0', iecAddress: '%IX0.0', alias: '' }],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleNoHwId])
    const slot = (result.slots as Array<Record<string, unknown>>)[0]
    expect(slot.module_hw_id).toBeUndefined()
  })

  it('skips channels whose IEC address is missing from the io-mapping', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: ['di-8'] },
      'io-mapping': {
        entries: [
          // Only I0 has an address; I1 was unmapped.
          { slot: 1, channelName: 'I0', iecAddress: '%IX0.0', alias: '' },
        ],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleDi8])
    const slot = (result.slots as Array<{ io_mapping: { digital_inputs: { count: number } } }>)[0]
    expect(slot.io_mapping.digital_inputs.count).toBe(1)
  })

  it('emits an empty io_mapping block when no channels have addresses', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: ['di-8'] },
      'io-mapping': { entries: [] },
    }
    const result = generateVendorPluginConfig({}, data, [moduleDi8])
    expect((result.slots as Array<{ io_mapping: object }>)[0].io_mapping).toEqual({})
  })

  it('aborts the bit-range build when an address fails to parse', () => {
    const moduleBadAddr: VppModuleDefinition = {
      id: 'di-bad',
      name: 'DI-bad',
      addressMapping: {
        channels: [
          { name: 'I0', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' },
          { name: 'I1', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' },
        ],
      },
    }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['di-bad'] },
      'io-mapping': {
        entries: [
          { slot: 1, channelName: 'I0', iecAddress: '%IX0.0', alias: '' },
          { slot: 1, channelName: 'I1', iecAddress: 'NOT_AN_IEC_ADDRESS', alias: '' },
        ],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleBadAddr])
    const slot = (result.slots as Array<{ io_mapping: object }>)[0]
    expect(slot.io_mapping).toEqual({}) // bit-range failed, so digital_inputs is omitted
  })

  it('handles modules with no addressMapping (zero channels)', () => {
    const moduleEmpty: VppModuleDefinition = { id: 'empty', name: 'Empty' }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['empty'] },
      'io-mapping': { entries: [] },
    }
    const result = generateVendorPluginConfig({}, data, [moduleEmpty])
    expect(result.slots).toEqual([{ slot: 1, io_mapping: {} }])
  })

  it('falls through gracefully when vendorScreenData is empty', () => {
    const result = generateVendorPluginConfig({ plugin_name: 'foo' }, {}, [moduleDi8])
    expect(result).toEqual({ plugin_name: 'foo', slots: [] })
  })

  it('aborts the word-range build when a word address fails to parse', () => {
    const moduleBadWord: VppModuleDefinition = {
      id: 'ai-bad',
      name: 'AI-bad',
      addressMapping: {
        channels: [
          { name: 'A0', type: 'analogInput', dataType: 'INT', addressPrefix: '%IW' },
          { name: 'A1', type: 'analogInput', dataType: 'INT', addressPrefix: '%IW' },
        ],
      },
    }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['ai-bad'] },
      'io-mapping': {
        entries: [
          { slot: 1, channelName: 'A0', iecAddress: '%IW10', alias: '' },
          // Word-shaped prefix but a bit-shaped body - parseWordAddress returns null
          { slot: 1, channelName: 'A1', iecAddress: '%IW0.1', alias: '' },
        ],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleBadWord])
    const slot = (result.slots as Array<{ io_mapping: object }>)[0]
    // word-range failed → analog_inputs is omitted entirely
    expect(slot.io_mapping).toEqual({})
  })

  it('skips channels with an unrecognised type (no di/do/ai/ao branch)', () => {
    const moduleWeird: VppModuleDefinition = {
      id: 'weird',
      name: 'Weird',
      addressMapping: {
        // Cast through unknown to reach the no-match else-if tail.
        channels: [{ name: 'X0', type: 'mystery', dataType: 'BOOL', addressPrefix: '%MX' } as unknown as never],
      },
    }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['weird'] },
      'io-mapping': {
        entries: [{ slot: 1, channelName: 'X0', iecAddress: '%MX0.0', alias: '' }],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleWeird])
    const slot = (result.slots as Array<{ io_mapping: object }>)[0]
    expect(slot.io_mapping).toEqual({})
  })

  it('builds digital outputs and analog outputs alongside inputs in one slot', () => {
    const moduleMixed: VppModuleDefinition = {
      id: 'mixed',
      name: 'Mixed',
      hwId: '0x1234',
      addressMapping: {
        channels: [
          { name: 'I0', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' },
          { name: 'O0', type: 'digitalOutput', dataType: 'BOOL', addressPrefix: '%QX' },
          { name: 'AI0', type: 'analogInput', dataType: 'INT', addressPrefix: '%IW' },
          { name: 'AO0', type: 'analogOutput', dataType: 'INT', addressPrefix: '%QW' },
        ],
      },
    }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['mixed'] },
      'io-mapping': {
        entries: [
          { slot: 1, channelName: 'I0', iecAddress: '%IX0.0', alias: '' },
          { slot: 1, channelName: 'O0', iecAddress: '%QX0.0', alias: '' },
          { slot: 1, channelName: 'AI0', iecAddress: '%IW0', alias: '' },
          { slot: 1, channelName: 'AO0', iecAddress: '%QW0', alias: '' },
        ],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleMixed])
    const slot = (result.slots as Array<{ io_mapping: Record<string, unknown> }>)[0]
    expect(Object.keys(slot.io_mapping).sort()).toEqual([
      'analog_inputs',
      'analog_outputs',
      'digital_inputs',
      'digital_outputs',
    ])
  })
})
