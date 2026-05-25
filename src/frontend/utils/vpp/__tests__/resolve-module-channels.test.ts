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
})
