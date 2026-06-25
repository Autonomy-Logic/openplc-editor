import {
  buildModuleConfigEntries,
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

// REAL-typed analog input module (e.g. SLM-THM-4): channels live in the
// 32-bit image table (%ID) so the plugin gets IEEE-754 floats with no
// scaling loss.
const moduleRealAi2 = {
  id: 'real-ai-2',
  name: 'Real-AI-2',
  hwId: '0xFEEDFACE',
  addressMapping: {
    channels: [
      { name: 'TC1', type: 'analogInput', dataType: 'REAL', addressPrefix: '%ID' },
      { name: 'TC2', type: 'analogInput', dataType: 'REAL', addressPrefix: '%ID' },
    ],
  },
} satisfies VppModuleDefinition

// A module with a configScreen — used for module_config encoding tests.
const moduleThm4 = {
  id: 'thm-4',
  name: 'THM-4',
  hwId: '0x34608CE1',
  addressMapping: {
    channels: [{ name: 'TC1', type: 'analogInput', dataType: 'INT', addressPrefix: '%IW' }],
  },
  configScreenDefinition: {
    sections: [
      {
        id: 'config',
        layout: 'form',
        totalBytes: 20,
        fields: [
          {
            id: 'channels_enabled',
            label: 'Channels',
            type: 'select',
            default: '0x4003',
            encoding: { byteOffset: 0, size: 2, endian: 'big' },
          },
          {
            id: 'burnout_units',
            label: 'Burnout / Units',
            type: 'select',
            default: '0x6005',
            encoding: { byteOffset: 2, size: 2, endian: 'big' },
          },
          {
            id: 'ch1_type',
            label: 'CH1 Type',
            type: 'select',
            default: '0x0',
            encoding: { byteOffset: 4, size: 2, endian: 'big', base: '0x2100', mask: '0x000F' },
          },
        ],
      },
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

  it('preserves boolean `false` toggles from form data (SLM-RP4 fault-detection regression)', () => {
    // User-reported scenario: the SLM-RP4 HAL Settings screen's
    // "Enable Bus Fault Detection" toggle was suspected of not
    // making it to the runtime when set to false. The generator's
    // `Object.assign(result, value)` MUST forward `false` verbatim
    // — a stricter falsy check would silently drop the toggle and
    // leave the plugin keying off its bundled default of `1`.
    const result = generateVendorPluginConfig(
      { plugin_name: 'synergy' },
      {
        'hal-config': {
          fault_detection_enabled: false,
          fault_threshold: 25,
          fault_action: 'log_and_retry',
          scan_cycle_ms: 10,
        },
      },
      [],
    )
    expect(result.fault_detection_enabled).toBe(false)
    expect(result.fault_threshold).toBe(25)
    expect(result.fault_action).toBe('log_and_retry')
    expect(result.scan_cycle_ms).toBe(10)
    // JSON serialisation MUST emit `false` (not `0`, not absent) so the
    // plugin's cJSON_IsBool branch takes — the only branch that
    // honours boolean false. A `0`-numeric here would still parse, but
    // the load-bearing path is the bool case.
    expect(JSON.stringify(result)).toContain('"fault_detection_enabled":false')
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

  it('builds dword-range mapping for REAL analog inputs (%ID)', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: ['real-ai-2'] },
      'io-mapping': {
        entries: [
          { slot: 1, channelName: 'TC1', iecAddress: '%ID5', alias: '' },
          { slot: 1, channelName: 'TC2', iecAddress: '%ID6', alias: '' },
        ],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleRealAi2])
    const slot = (result.slots as Array<{ io_mapping: { analog_real_inputs: unknown; analog_inputs?: unknown } }>)[0]
    expect(slot.io_mapping.analog_real_inputs).toEqual({ base_dword: 5, count: 2 })
    // %ID channels must not double-emit into analog_inputs.
    expect(slot.io_mapping.analog_inputs).toBeUndefined()
  })

  it('builds dword-range mapping for REAL analog outputs (%QD)', () => {
    const moduleRealAo: VppModuleDefinition = {
      id: 'real-ao-1',
      name: 'Real-AO-1',
      addressMapping: {
        channels: [{ name: 'AO1', type: 'analogOutput', dataType: 'REAL', addressPrefix: '%QD' }],
      },
    }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['real-ao-1'] },
      'io-mapping': {
        entries: [{ slot: 1, channelName: 'AO1', iecAddress: '%QD3', alias: '' }],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleRealAo])
    const slot = (result.slots as Array<{ io_mapping: { analog_real_outputs: unknown } }>)[0]
    expect(slot.io_mapping.analog_real_outputs).toEqual({ base_dword: 3, count: 1 })
  })

  it('mixes %IW and %ID channels in a single slot into separate buckets', () => {
    const moduleMixed: VppModuleDefinition = {
      id: 'mixed',
      name: 'Mixed',
      addressMapping: {
        channels: [
          { name: 'AI1', type: 'analogInput', dataType: 'UINT', addressPrefix: '%IW' },
          { name: 'TC1', type: 'analogInput', dataType: 'REAL', addressPrefix: '%ID' },
        ],
      },
    }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['mixed'] },
      'io-mapping': {
        entries: [
          { slot: 1, channelName: 'AI1', iecAddress: '%IW20', alias: '' },
          { slot: 1, channelName: 'TC1', iecAddress: '%ID4', alias: '' },
        ],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleMixed])
    const slot = (result.slots as Array<{ io_mapping: { analog_inputs: unknown; analog_real_inputs: unknown } }>)[0]
    expect(slot.io_mapping.analog_inputs).toEqual({ base_word: 20, count: 1 })
    expect(slot.io_mapping.analog_real_inputs).toEqual({ base_dword: 4, count: 1 })
  })

  it('routes by io-mapping address even when manifest channels still carry the raw prefix', () => {
    // Simulates a channelsByFormat module (SLM-AI4-AO2-V) flipped to
    // engineering mode: the manifest's `channels` array (the raw-mode
    // fallback) declares %IW/%QW, but the editor allocated %ID/%QD.
    // The generator must follow the allocated addresses, not the
    // manifest's static prefixes — otherwise the plugin gets no
    // analog_real_inputs block and the REAL path silently never fires.
    const channelsByFormatModule: VppModuleDefinition = {
      id: 'ai4-ao2-flip',
      name: 'AI4-AO2 Flip',
      addressMapping: {
        channels: [
          { name: 'AI1', type: 'analogInput', dataType: 'UINT', addressPrefix: '%IW' },
          { name: 'AI2', type: 'analogInput', dataType: 'UINT', addressPrefix: '%IW' },
          { name: 'AO1', type: 'analogOutput', dataType: 'UINT', addressPrefix: '%QW' },
        ],
      },
    }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['ai4-ao2-flip'] },
      'io-mapping': {
        entries: [
          // editor allocated REAL/%ID/%QD addresses based on the slot
          // being in engineering mode, even though the fallback
          // `channels` array above still says %IW/%QW.
          { slot: 1, channelName: 'AI1', iecAddress: '%ID0', alias: '' },
          { slot: 1, channelName: 'AI2', iecAddress: '%ID1', alias: '' },
          { slot: 1, channelName: 'AO1', iecAddress: '%QD0', alias: '' },
        ],
      },
    }
    const result = generateVendorPluginConfig({}, data, [channelsByFormatModule])
    const slot = (
      result.slots as Array<{
        io_mapping: {
          analog_inputs?: unknown
          analog_outputs?: unknown
          analog_real_inputs?: unknown
          analog_real_outputs?: unknown
        }
      }>
    )[0]
    expect(slot.io_mapping.analog_real_inputs).toEqual({ base_dword: 0, count: 2 })
    expect(slot.io_mapping.analog_real_outputs).toEqual({ base_dword: 0, count: 1 })
    expect(slot.io_mapping.analog_inputs).toBeUndefined()
    expect(slot.io_mapping.analog_outputs).toBeUndefined()
  })

  it('aborts the dword-range build when an address fails to parse', () => {
    const moduleBad: VppModuleDefinition = {
      id: 'real-bad',
      name: 'Real-bad',
      addressMapping: {
        channels: [{ name: 'TC1', type: 'analogInput', dataType: 'REAL', addressPrefix: '%ID' }],
      },
    }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['real-bad'] },
      'io-mapping': {
        entries: [{ slot: 1, channelName: 'TC1', iecAddress: 'not-an-address', alias: '' }],
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleBad])
    const slot = (result.slots as Array<{ io_mapping: object }>)[0]
    // Unparseable address means the channel is dropped entirely (no
    // entry in any bucket), so io_mapping ends up empty.
    expect(slot.io_mapping).toEqual({})
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

  it('drops channels whose io-mapping address has no recognized prefix', () => {
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
    const slot = (result.slots as Array<{ io_mapping: { digital_inputs?: { count: number } } }>)[0]
    // The unparseable address is silently skipped; the valid one is
    // still emitted (partial success rather than all-or-nothing).
    expect(slot.io_mapping.digital_inputs).toEqual({ base_byte: 0, base_bit: 0, count: 1 })
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

  /* ------------------------------------------------------------ */
  /* module_config (per-slot configuration bytes)                  */
  /* ------------------------------------------------------------ */

  it('emits module_config built from field defaults when the user has not set values', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: ['thm-4'] },
      'io-mapping': { entries: [] },
    }
    const result = generateVendorPluginConfig({}, data, [moduleThm4])
    const slot = (result.slots as Array<{ module_config?: string }>)[0]
    // defaults: channels=0x4003, burnout/units=0x6005, ch1=type J (0x2100|0=0x2100)
    // padded to totalBytes=20
    expect(slot.module_config).toBe('40 03 60 05 21 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00')
  })

  it('lets per-slot user values override field defaults', () => {
    const data: VendorScreenData = {
      'module-configuration': {
        slots: ['thm-4'],
        slotsConfig: {
          '1': { channels_enabled: '0x4001', burnout_units: '0x6001', ch1_type: '0x1' },
        },
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleThm4])
    const slot = (result.slots as Array<{ module_config?: string }>)[0]
    // 0x4001 / 0x6001 / 0x2101 (CH1 type K)
    expect(slot.module_config?.startsWith('40 01 60 01 21 01')).toBe(true)
  })

  it('omits module_config when the module has no configScreenDefinition', () => {
    const data: VendorScreenData = {
      'module-configuration': { slots: ['di-8'] },
      'io-mapping': { entries: [] },
    }
    const result = generateVendorPluginConfig({}, data, [moduleDi8])
    const slot = (result.slots as Array<{ module_config?: string }>)[0]
    expect(slot.module_config).toBeUndefined()
  })

  it('omits module_config when the configScreen declares no encodable fields', () => {
    const moduleEmpty: VppModuleDefinition = {
      id: 'empty-screen',
      name: 'Empty',
      hwId: '0xAA',
      addressMapping: { channels: [] },
      configScreenDefinition: { sections: [{ id: 'x', fields: [] }] },
    }
    const data: VendorScreenData = {
      'module-configuration': { slots: ['empty-screen'] },
    }
    const result = generateVendorPluginConfig({}, data, [moduleEmpty])
    const slot = (result.slots as Array<{ module_config?: string }>)[0]
    expect(slot.module_config).toBeUndefined()
  })

  it('handles malformed configScreenDefinitions gracefully', () => {
    // sections is not an array, fields is not an array, items have no id —
    // collectConfigFormFields must silently skip and return no fields.
    const moduleBad: VppModuleDefinition = {
      id: 'bad-screen',
      name: 'Bad',
      hwId: '0xBB',
      addressMapping: { channels: [] },
      configScreenDefinition: {
        sections: [
          null,
          'not-an-object',
          { fields: 'not-an-array' },
          { fields: [null, 'string-field', { /* no id */ encoding: { byteOffset: 0, size: 1 } }] },
        ],
      },
    }
    const data: VendorScreenData = { 'module-configuration': { slots: ['bad-screen'] } }
    const result = generateVendorPluginConfig({}, data, [moduleBad])
    const slot = (result.slots as Array<{ module_config?: string }>)[0]
    expect(slot.module_config).toBeUndefined()
  })

  it('omits module_config when configScreenDefinition is explicitly null', () => {
    const moduleNullDef: VppModuleDefinition = {
      id: 'null-def',
      name: 'Null',
      hwId: '0xCC',
      addressMapping: { channels: [] },
      configScreenDefinition: null,
    }
    const data: VendorScreenData = { 'module-configuration': { slots: ['null-def'] } }
    const result = generateVendorPluginConfig({}, data, [moduleNullDef])
    const slot = (result.slots as Array<{ module_config?: string }>)[0]
    expect(slot.module_config).toBeUndefined()
  })

  it('falls back to encoder-computed length when totalBytes is absent', () => {
    const moduleShort: VppModuleDefinition = {
      id: 'short',
      name: 'Short',
      hwId: '0xDD',
      addressMapping: { channels: [] },
      configScreenDefinition: {
        sections: [
          {
            id: 'cfg',
            layout: 'form',
            fields: [
              {
                id: 'channels_enabled',
                label: 'Channels',
                type: 'select',
                default: '0x4007',
                encoding: { byteOffset: 0, size: 2, endian: 'big' },
              },
            ],
          },
        ],
      },
    }
    const data: VendorScreenData = { 'module-configuration': { slots: ['short'] } }
    const result = generateVendorPluginConfig({}, data, [moduleShort])
    const slot = (result.slots as Array<{ module_config?: string }>)[0]
    expect(slot.module_config).toBe('40 07')
  })

  it('treats empty-string user values as "use the default"', () => {
    const data: VendorScreenData = {
      'module-configuration': {
        slots: ['thm-4'],
        slotsConfig: { '1': { channels_enabled: '' } },
      },
    }
    const result = generateVendorPluginConfig({}, data, [moduleThm4])
    const slot = (result.slots as Array<{ module_config?: string }>)[0]
    // empty -> use default 0x4003
    expect(slot.module_config?.startsWith('40 03')).toBe(true)
  })
})

describe('generateVendorPluginConfig — pins[] (GPIO pin-mapping)', () => {
  it('omits pins[] when no device pins are supplied', () => {
    const result = generateVendorPluginConfig({ plugin_name: 'rpi_gpio' }, {}, [])
    expect(result.pins).toBeUndefined()
  })

  it('maps digital input/output pins to pin + direction + byte/bit', () => {
    const result = generateVendorPluginConfig(
      { plugin_name: 'rpi_gpio' },
      {},
      [],
      [
        { pin: '11', pinType: 'digitalOutput', address: '%QX0.0' },
        { pin: '13', pinType: 'digitalInput', address: '%IX1.3' },
      ],
    )
    expect(result.pins).toEqual([
      { pin: 11, direction: 'output', byte: 0, bit: 0 },
      { pin: 13, direction: 'input', byte: 1, bit: 3 },
    ])
  })

  it('maps analog outputs to PWM (word index) and skips analog inputs', () => {
    const result = generateVendorPluginConfig(
      {},
      {},
      [],
      [
        { pin: '11', pinType: 'digitalOutput', address: '%QX0.0' },
        { pin: '26', pinType: 'analogInput', address: '%IW0' },
        { pin: '12', pinType: 'analogOutput', address: '%QW3' },
      ],
    )
    expect(result.pins).toEqual([
      { pin: 11, direction: 'output', byte: 0, bit: 0 },
      { pin: 12, direction: 'pwm', word: 3 },
    ])
  })

  it('skips rows with a non-numeric pin or an unparseable address', () => {
    const result = generateVendorPluginConfig(
      {},
      {},
      [],
      [
        { pin: 'P11', pinType: 'digitalOutput', address: '%QX0.0' },
        { pin: '18', pinType: 'digitalOutput', address: '' },
        { pin: '22', pinType: 'digitalInput', address: '%IX2.1' },
      ],
    )
    expect(result.pins).toEqual([{ pin: 22, direction: 'input', byte: 2, bit: 1 }])
  })

  it('emits pins[] alongside an empty slots[] for pin-only boards', () => {
    const result = generateVendorPluginConfig(
      { plugin_name: 'rpi_gpio' },
      {},
      [],
      [{ pin: '11', pinType: 'digitalOutput', address: '%QX0.0' }],
    )
    expect(result.slots).toEqual([])
    expect(result.pins).toEqual([{ pin: 11, direction: 'output', byte: 0, bit: 0 }])
  })
})

describe('buildModuleConfigEntries', () => {
  const modules: VppModuleDefinition[] = [moduleDi8, moduleThm4]

  it('encodes per-slot config bytes for a configurable module, keyed by 1-based slot', () => {
    const vsd = {
      'module-configuration': {
        slots: [null, 'thm-4'], // slot 2 holds the THM-4
        slotsConfig: { '2': { ch1_type: '0x5' } }, // override CH1 -> Type T
      },
    } as unknown as VendorScreenData
    const entries = buildModuleConfigEntries(vsd, modules)
    expect(entries).toHaveLength(1)
    expect(entries[0].slot).toBe(2)
    // 20-byte buffer: 0x4003, 0x6005 defaults, ch1 = 0x2100 | 0x5 = 0x2105
    expect(entries[0].bytes).toHaveLength(20)
    expect(entries[0].bytes.slice(0, 6)).toEqual([0x40, 0x03, 0x60, 0x05, 0x21, 0x05])
  })

  it('falls back to field defaults when the user set no values', () => {
    const vsd = {
      'module-configuration': { slots: ['thm-4'] },
    } as unknown as VendorScreenData
    const entries = buildModuleConfigEntries(vsd, modules)
    expect(entries).toHaveLength(1)
    expect(entries[0].slot).toBe(1)
    // ch1 defaults to 0x0 -> 0x2100 | 0x0 = 0x2100
    expect(entries[0].bytes.slice(0, 6)).toEqual([0x40, 0x03, 0x60, 0x05, 0x21, 0x00])
  })

  it('omits modules with no configScreen and unknown/empty slots', () => {
    const vsd = {
      'module-configuration': { slots: ['di-8', null, 'not-a-module'] },
    } as unknown as VendorScreenData
    expect(buildModuleConfigEntries(vsd, modules)).toEqual([])
  })

  it('returns [] when there is no module-configuration', () => {
    expect(buildModuleConfigEntries({} as VendorScreenData, modules)).toEqual([])
  })
})
