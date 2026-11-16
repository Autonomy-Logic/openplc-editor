import { describe, expect, it } from '@jest/globals'

import { manifestModuleFromCapture } from '../../../../../__fixtures__/device-editor-datapoints/manifest-module'
import { UR20_2DI_P_TS } from '../../../../../__fixtures__/device-editor-datapoints/ur20-2di-p-ts'
import { UR20_16DI_16DO } from '../../../../../__fixtures__/device-editor-datapoints/ur20-16di-16do'
import { generateIoRangesPluginConfig, type IoRangesModule } from '../generate-io-ranges-plugin-config'

const TEMPLATE = { plugin_name: 'weidmuller', version: '1.0.0', wire_byte_order: 'little', inputs: [], outputs: [] }

const TS = manifestModuleFromCapture(UR20_2DI_P_TS, 0, { id: 'ur20-2di-p-ts', name: 'UR20-2DI-P-TS' })
const DI = manifestModuleFromCapture(UR20_16DI_16DO, 0, { id: 'ur20-16di-p', name: 'UR20-16DI-P' })
const DO = manifestModuleFromCapture(UR20_16DI_16DO, 1, { id: 'ur20-16do-p', name: 'UR20-16DO-P' })
const MODULES: IoRangesModule[] = [TS, DI, DO]

type Channel = { name: string; addressPrefix: string }

/** Addresses in slot then channel order, one counter per prefix, as the editor allocates them. */
function allocate(slots: string[]): Array<{ slot: number; channelName: string; iecAddress: string; alias: string }> {
  const next: Record<string, number> = {}
  const entries: Array<{ slot: number; channelName: string; iecAddress: string; alias: string }> = []
  slots.forEach((id, index) => {
    const module = MODULES.find((candidate) => candidate.id === id)
    const channels = (module?.addressMapping as { channels: Channel[] }).channels
    for (const channel of channels) {
      const n = next[channel.addressPrefix] ?? 0
      next[channel.addressPrefix] = n + 1
      const iecAddress = channel.addressPrefix.endsWith('X')
        ? `${channel.addressPrefix}${Math.floor(n / 8)}.${n % 8}`
        : `${channel.addressPrefix}${n}`
      entries.push({ slot: index + 1, channelName: channel.name, iecAddress, alias: '' })
    }
  })
  return entries
}

function screenData(slots: Array<string | null>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'module-configuration': { slots },
    'io-mapping': { entries: allocate(slots.filter((slot): slot is string => slot !== null)) },
    ...extra,
  }
}

function generate(data: Record<string, unknown>, archive: { fileName: string; sha256: string } | null = null) {
  const result = generateIoRangesPluginConfig(TEMPLATE, data, MODULES, archive)
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result.config
}

describe('generateIoRangesPluginConfig', () => {
  it('maps the captured UR20-2DI-P-TS (30 %IB + 15 %IW) to ranges at the vendor wire offsets', () => {
    const config = generate(screenData(['ur20-2di-p-ts']))
    const inputs = config.inputs as Array<Record<string, unknown>>

    expect(config.outputs).toEqual([])
    expect(inputs).toHaveLength(30)
    expect(inputs.slice(0, 4)).toEqual([
      { kind: 'byte', wire_byte: 0, plc_index: 0, count: 2, slot: 0, module: 'UR20-2DI-P-TS' },
      { kind: 'word', wire_byte: 2, plc_index: 0, count: 1, slot: 0, module: 'UR20-2DI-P-TS' },
      { kind: 'byte', wire_byte: 4, plc_index: 2, count: 2, slot: 0, module: 'UR20-2DI-P-TS' },
      { kind: 'word', wire_byte: 6, plc_index: 1, count: 1, slot: 0, module: 'UR20-2DI-P-TS' },
    ])
    expect(inputs.at(-1)).toEqual({
      kind: 'word',
      wire_byte: 58,
      plc_index: 14,
      count: 1,
      slot: 0,
      module: 'UR20-2DI-P-TS',
    })
    const channels = inputs.reduce((sum, range) => sum + (range.count as number), 0)
    expect(channels).toBe(45)
  })

  it('offsets each slot by the process image bytes of the earlier slots, per direction', () => {
    const config = generate(screenData(['ur20-2di-p-ts', 'ur20-16di-p', 'ur20-16do-p']))

    expect((config.inputs as unknown[]).at(-1)).toEqual({
      kind: 'bool',
      wire_byte: 60,
      wire_bit: 0,
      plc_byte: 0,
      plc_bit: 0,
      count: 16,
      slot: 1,
      module: 'UR20-16DI-P',
    })
    expect(config.outputs).toEqual([
      {
        kind: 'bool',
        wire_byte: 0,
        wire_bit: 0,
        plc_byte: 0,
        plc_bit: 0,
        count: 16,
        slot: 2,
        module: 'UR20-16DO-P',
      },
    ])
  })

  it('splits a run where the PLC side is not contiguous', () => {
    const data = screenData(['ur20-16di-p'])
    const entries = (data['io-mapping'] as { entries: Array<{ channelName: string; iecAddress: string }> }).entries
    const di8 = entries.find((entry) => entry.channelName === 'DI_8')
    if (!di8) throw new Error('DI_8 missing from the capture')
    di8.iecAddress = '%IX5.0'

    const inputs = generate(data).inputs as Array<Record<string, unknown>>

    expect(
      inputs.map((range) => [range.wire_byte, range.wire_bit, range.plc_byte, range.plc_bit, range.count]),
    ).toEqual([
      [0, 0, 0, 0, 8],
      [1, 0, 5, 0, 1],
      [1, 1, 1, 1, 7],
    ])
  })

  it('names the archive and its hash, and keeps the template keys', () => {
    const config = generate(screenData(['ur20-16di-p']), {
      fileName: 'weidmuller.station.bin',
      sha256: 'ab'.repeat(32),
    })

    expect(config.plugin_name).toBe('weidmuller')
    expect(config.wire_byte_order).toBe('little')
    expect(config.configuration_archive).toBe('weidmuller.station.bin')
    expect(config.configuration_sha256).toBe('ab'.repeat(32))
  })

  it('leaves the archive keys out without an archive', () => {
    const config = generate(screenData(['ur20-16di-p']))

    expect(config).not.toHaveProperty('configuration_archive')
    expect(config).not.toHaveProperty('configuration_sha256')
  })

  it('never merges the configurator, device setup, slots or mapping into the root', () => {
    const config = generate(
      screenData(['ur20-16di-p'], {
        configurator: { archive: 'ff', controller: 'UC20-M3000', bundleVersion: '3.5.22' },
        'device-setup': { modules: [] },
        settings: { lock_budget_us: 500 },
      }),
    )

    expect(config.lock_budget_us).toBe(500)
    for (const key of ['archive', 'controller', 'bundleVersion', 'modules', 'slots', 'entries']) {
      expect(config).not.toHaveProperty(key)
    }
  })

  it('refuses a station with a module that is not in the catalogue, naming it', () => {
    const result = generateIoRangesPluginConfig(
      TEMPLATE,
      screenData(['ur20-16di-p', null], {
        'device-setup': {
          modules: [
            { guid: 'a', instanceName: 'UR20_16DI_P_1', typeId: '00049fc2', slot: 1 },
            { guid: 'b', instanceName: 'UR20_NEW_1', typeId: 'deadbeef', slot: 2 },
          ],
        },
      }),
      MODULES,
      null,
    )

    expect(result).toEqual({
      ok: false,
      errors: ['Slot 2: UR20_NEW_1 (type deadbeef) is not in the package catalogue, so its I/O cannot be mapped'],
    })
  })

  it('refuses a module without a process image', () => {
    const { processImage: _omitted, ...withoutImage } = DI
    const result = generateIoRangesPluginConfig(TEMPLATE, screenData(['ur20-16di-p']), [withoutImage], null)

    expect(result).toEqual({ ok: false, errors: ['Slot 1: module UR20-16DI-P declares no processImage'] })
  })

  it('refuses a channel without a wire position', () => {
    const channels = (DI.addressMapping as { channels: Array<Record<string, unknown>> }).channels
    const broken = { ...DI, addressMapping: { channels: channels.map(({ wire: _wire, ...rest }) => rest) } }
    const result = generateIoRangesPluginConfig(TEMPLATE, screenData(['ur20-16di-p']), [broken], null)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toBe('Slot 1: DI_0 of UR20-16DI-P declares no valid wire position')
  })

  it('refuses a mapped channel the manifest channel list does not declare', () => {
    const variant = { ...DI, addressMapping: { channelsByFormat: { raw: [] }, channels: [] } }
    const result = generateIoRangesPluginConfig(TEMPLATE, screenData(['ur20-16di-p']), [variant], null)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(16)
      expect(result.errors[0]).toBe(
        'Slot 1: DI_0 is not a channel of UR20-16DI-P in the manifest, so it cannot be mapped',
      )
    }
  })

  it('refuses an address it cannot place', () => {
    const data = screenData(['ur20-16di-p'])
    const entries = (data['io-mapping'] as { entries: Array<{ iecAddress: string }> }).entries
    entries[0].iecAddress = '%IX0'

    const result = generateIoRangesPluginConfig(TEMPLATE, data, MODULES, null)

    expect(result).toEqual({ ok: false, errors: ['Slot 1: DI_0 has an unsupported address %IX0'] })
  })

  it('returns errors, never throws, on malformed stored records', () => {
    const data = screenData(['ur20-16di-p', null], {
      'device-setup': { modules: [null, 7, { slot: 2, instanceName: 'UR20_NEW_1', typeId: 'deadbeef' }] },
    })
    ;(data['io-mapping'] as { entries: unknown[] }).entries.unshift(null, 'x', 3)

    const result = generateIoRangesPluginConfig(TEMPLATE, data, MODULES, null)

    expect(result).toEqual({
      ok: false,
      errors: ['Slot 2: UR20_NEW_1 (type deadbeef) is not in the package catalogue, so its I/O cannot be mapped'],
    })
    expect(
      generateIoRangesPluginConfig(TEMPLATE, { 'module-configuration': null, 'io-mapping': 'x' }, MODULES, null),
    ).toEqual({ ok: true, config: expect.objectContaining({ inputs: [], outputs: [] }) })
  })

  it('skips channels with no address and emits empty ranges for an empty station', () => {
    expect(generate({}).inputs).toEqual([])
    const data = screenData(['ur20-16di-p'])
    ;(data['io-mapping'] as { entries: unknown[] }).entries = []
    expect(generate(data).inputs).toEqual([])
  })
})
