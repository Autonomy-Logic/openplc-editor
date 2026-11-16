/**
 * Edge cases of the EtherCAT helpers shared by the editor and the generator: index
 * arithmetic, InitCmd conversion, ZIP import filtering and the project validator's
 * fallbacks.
 */

import JSZip from 'jszip'

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type { EsiPort } from '@root/middleware/shared/ports/esi-port'
import type { ConfiguredEtherCATDevice, ESIModule } from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../../../../../backend/shared/ethercat/device-config-defaults'
import { resolveEsiModule } from '../esi-module-resolve'
import { decodeXmlBytes, importESIZip, MAX_ZIP_TOTAL_BYTES } from '../esi-zip-import'
import { initCmdsToSdoEntries, initCmdToSdoEntry, sdoTransitions } from '../init-cmd-sdo'
import { buildModuleForSlot, hexAdd, slotDeltas } from '../module-build'
import { validateEthercatProject } from '../validate-ethercat-project'

describe('hexAdd and slotDeltas', () => {
  test('keeps an upper-case prefix, adds one to a bare hex string, and leaves non-hex input alone', () => {
    expect(hexAdd('0X8000', 0x10)).toBe('0X8010')
    expect(hexAdd('1A00', 1)).toBe('0x1A01')
    expect(hexAdd('#x8000', 0x10)).toBe('#x8000')
  })

  test('a slot below 1 gets no offset', () => {
    expect(slotDeltas(0, { slotIndexIncrement: 16, slotPdoIncrement: 1 })).toEqual({ indexDelta: 0, pdoDelta: 0 })
  })
})

describe('buildModuleForSlot without slot-dependent data', () => {
  const plain: ESIModule = {
    ident: '0x1',
    name: 'Power feed',
    rxPdo: [],
    txPdo: [
      {
        index: '0x1A80',
        name: 'Status',
        fixed: false,
        mandatory: false,
        smIndex: 3,
        entries: [{ index: '0x6800', subIndex: '0x01', bitLen: 8, name: 'State', dataType: 'USINT' }],
      },
    ],
    initCmds: [],
  }

  test('indices stay put, Fixed/Mandatory false are not persisted, no InitCmds leaves no SDO list', () => {
    const m = buildModuleForSlot({
      id: 'm',
      slot: 4,
      esiModule: plain,
      increments: { slotIndexIncrement: 16, slotPdoIncrement: 1 },
      repositoryItemId: 'r',
      usedAddresses: new Set(),
    })
    expect(m.txPdos?.[0]).toMatchObject({ index: '0x1A80', fixed: undefined, mandatory: undefined })
    expect(m.txPdos?.[0]?.entries[0]?.index).toBe('0x6800')
    expect(m.sdoConfigurations).toBeUndefined()
  })

  test('a module without process data has no channel info', () => {
    const m = buildModuleForSlot({
      id: 'm',
      slot: 1,
      esiModule: { ...plain, txPdo: [] },
      increments: { slotIndexIncrement: 16, slotPdoIncrement: 1 },
      repositoryItemId: 'r',
      usedAddresses: new Set(),
    })
    expect(m.channelInfo).toBeUndefined()
    expect(m.channelMappings).toEqual([])
  })
})

describe('InitCmd conversion', () => {
  test('<DataAscii> becomes a byte string', () => {
    expect(initCmdToSdoEntry({ transition: 'PS', index: '0x8000', subIndex: 3, dataAscii: 'AB' }, 'x')).toMatchObject({
      valueBytes: '0x4142',
      bitLength: 16,
      transition: 'PS',
    })
  })

  test('a <Value> without a type is a UDINT; an unknown type defaults to 32 bits', () => {
    expect(initCmdToSdoEntry({ transition: 'PS', index: '0x1', subIndex: 0, value: 5 }, 'x')).toMatchObject({
      dataType: 'UDINT',
      bitLength: 32,
    })
    expect(
      initCmdToSdoEntry({ transition: 'PS', index: '0x1', subIndex: 0, value: 5, dataType: 'FOO' }, 'x')?.bitLength,
    ).toBe(32)
  })

  test('commands without a payload are dropped and an absent list is empty', () => {
    expect(initCmdsToSdoEntries([{ transition: 'PS', index: '0x1', subIndex: 0 }], 'x')).toEqual([])
    expect(initCmdsToSdoEntries(undefined, 'x')).toEqual([])
  })

  test('transitions are split, trimmed and upper-cased; a user SDO has none', () => {
    expect(sdoTransitions({ transition: ' ip , ps ' })).toEqual(['IP', 'PS'])
    expect(sdoTransitions({})).toEqual([])
  })
})

describe('ESI ZIP import filtering', () => {
  const zipOf = async (files: Array<{ path: string; content: string | Uint8Array }>): Promise<Uint8Array> => {
    const zip = new JSZip()
    for (const f of files) zip.file(f.path, f.content)
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  }

  test('hidden files and macOS metadata are skipped silently; other files are reported', async () => {
    const r = await importESIZip(
      await zipOf([
        { path: '.DS_Store', content: 'x' },
        { path: '__MACOSX/a.xml', content: '<EtherCATInfo/>' },
        { path: 'readme.txt', content: 'x' },
        { path: 'other.xml', content: '<root/>' },
      ]),
    )
    expect(r.imported).toEqual([])
    expect(r.dropped).toEqual(['readme.txt (not an XML file)', 'other.xml (not an ESI file)'])
  })

  test('entries past the total size limit are reported as such', async () => {
    const chunk = 30 * 1024 * 1024
    const count = Math.ceil(MAX_ZIP_TOTAL_BYTES / chunk) + 1
    const big = new Uint8Array(chunk).fill(0x20)
    big.set(new TextEncoder().encode('<EtherCATInfo>'))
    const files = Array.from({ length: count }, (_, i) => ({ path: `f${i}.xml`, content: big }))
    const r = await importESIZip(await zipOf(files))
    expect(r.dropped.some((d) => d.endsWith('(ZIP total size limit reached)'))).toBe(true)
  }, 60000)

  test('UTF-16 byte order marks and unknown encodings are decoded', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00])
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x3c, 0x00, 0x61])
    expect(decodeXmlBytes(le)).toBe('<a')
    expect(decodeXmlBytes(be)).toBe('<a')
    const unknown = new TextEncoder().encode('<?xml version="1.0" encoding="x-unknown-enc"?><a/>')
    expect(decodeXmlBytes(unknown)).toContain('<a/>')
  })
})

describe('resolveEsiModule when the module-only lookup throws', () => {
  test('returns undefined', async () => {
    const port: Pick<EsiPort, 'loadDeviceFull' | 'loadModuleFull'> = {
      loadDeviceFull: () => Promise.reject(new Error('no device')),
      loadModuleFull: () => Promise.reject(new Error('no module')),
    }
    expect(await resolveEsiModule(port, { id: 'r', devices: [] }, '0x1')).toBeUndefined()
  })
})

describe('validateEthercatProject fallbacks', () => {
  const slave: ConfiguredEtherCATDevice = {
    id: 's',
    name: '',
    esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
    vendorId: '0x1',
    productCode: '0x1',
    revisionNo: '0x1',
    addedFrom: 'repository',
    config: createDefaultSlaveConfig(),
    channelMappings: [],
    isModularCoupler: true,
    slotsSpec: {
      slots: [{ minInstances: 1, maxInstances: 1, moduleClasses: ['Di'] }],
      slotIndexIncrement: 16,
      slotPdoIncrement: 1,
      downloadModuleIdentList: false,
    },
    modules: [
      {
        id: 'm',
        slot: 1,
        name: 'old',
        ident: '0x9',
        esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x9' },
        channelMappings: [],
      },
    ],
  }

  test('unnamed bus and slave, unnamed slot definition, module of unknown class', () => {
    const remote: PLCRemoteDevice[] = [
      { name: '', protocol: 'ethercat', ethercatConfig: { devices: [slave] } },
      { name: 'mb', protocol: 'modbus-tcp' },
    ]
    expect(validateEthercatProject(remote)).toEqual([
      "EtherCAT bus '<unnamed bus>', slave ? ('<unnamed slave>'), module 'old' in slot 1: slot definition 1 does not accept module 0x9 (unknown class)",
    ])
  })

  test('a slot past the last definition is refused even when empty slots lead to it', () => {
    const s: ConfiguredEtherCATDevice = {
      ...slave,
      name: 'c',
      modules: [
        {
          id: 'm3',
          slot: 3,
          name: 'DI',
          ident: '0x9',
          moduleClass: 'Di',
          esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x9' },
          channelMappings: [],
        },
      ],
    }
    const errors = validateEthercatProject([{ name: 'b', protocol: 'ethercat', ethercatConfig: { devices: [s] } }])
    expect(errors).toEqual([expect.stringMatching(/slot 2 is past the last slot the coupler's ESI allows/)])
  })
})
