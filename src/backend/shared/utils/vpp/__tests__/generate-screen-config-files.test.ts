import { describe, expect, it } from '@jest/globals'

import type { VppScreenConfigInputs } from '../../../../../middleware/shared/ports/compiler-platform-port'
import { generateScreenConfigFiles, readScreenConfigDeclarations } from '../generate-screen-config-files'

const PACKAGE_ID = 'com.weidmuller.ucontrol'
const DATA_HUB = [{ storageId: 'data-hub', format: 'variable-exports', file: 'data-hub' }]
const FILE = 'conf/weidmuller.data-hub.json'

const debugMap = (leaves: Array<{ path: string; type: string; arr: number; elem: number }>): string =>
  JSON.stringify({
    version: 2,
    md5: 'deadbeef',
    typeTags: {},
    arrays: [{ index: 0, count: leaves.length }],
    leaves: leaves.map((l) => ({ arrayIdx: l.arr, elemIdx: l.elem, path: l.path, type: l.type, size: 2 })),
  })

const DEBUG_MAP = debugMap([
  { path: 'INSTANCE0.COUNTER', type: 'DINT', arr: 0, elem: 3 },
  { path: 'INSTANCE0.SPEED', type: 'REAL', arr: 0, elem: 4 },
  { path: 'INSTANCE0.POS', type: 'MY_STRUCT', arr: 0, elem: 5 },
  { path: 'ALARM', type: 'BOOL', arr: 1, elem: 0 },
])

function inputs(dataHub: unknown, debugMapContent = DEBUG_MAP): VppScreenConfigInputs {
  return {
    vppExtensions: { [PACKAGE_ID]: { 'data-hub': dataHub } },
    debugMapContent,
    instances: [{ name: 'INSTANCE0', program: 'main' }],
  }
}

function generate(dataHub: unknown, debugMapContent?: string) {
  return generateScreenConfigFiles({
    pluginName: 'weidmuller',
    packageId: PACKAGE_ID,
    screenConfigs: DATA_HUB,
    inputs: inputs(dataHub, debugMapContent),
  })
}

const read = (files: Record<string, string>): Record<string, unknown> =>
  JSON.parse(files[FILE]) as Record<string, unknown>

const ENABLED = { enabled: true, clientName: 'vplc', clientId: 'id', clientSecret: 'secret' }

describe('readScreenConfigDeclarations', () => {
  it('accepts a missing field as no declarations', () => {
    expect(readScreenConfigDeclarations(undefined)).toEqual({ declarations: [], errors: [] })
  })

  it.each([
    ['a non-array', { storageId: 'x' }, 'hal.screenConfigs must be an array'],
    ['an entry without storageId', [{ format: 'variable-exports', file: 'x' }], 'storageId'],
    ['an unknown format', [{ storageId: 'x', format: 'js', file: 'x' }], 'format must be one of: variable-exports'],
    ['a file that escapes conf/', [{ storageId: 'x', format: 'variable-exports', file: '../x' }], '.file must match'],
  ])('rejects %s', (_case, raw, message) => {
    const { declarations, errors } = readScreenConfigDeclarations(raw)
    expect(declarations).toEqual([])
    expect(errors.join('\n')).toContain(message)
  })

  it('rejects two entries writing the same file', () => {
    const entry = { storageId: 'a', format: 'variable-exports', file: 'data-hub' }
    expect(readScreenConfigDeclarations([entry, { ...entry, storageId: 'b' }]).errors).toEqual([
      'hal.screenConfigs[1].file "data-hub" is declared twice',
    ])
  })
})

describe('generateScreenConfigFiles: variable-exports', () => {
  it('writes enabled false when the screen was never enabled', () => {
    const result = generate(undefined)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(read(result.files)).toEqual({ enabled: false })
  })

  it('resolves program and global variables to their debug-map entries', () => {
    const result = generate({
      ...ENABLED,
      natsAddress: ' 172.18.0.1:49360 ',
      exports: [
        { qualifier: 'main.counter', direction: 'RW' },
        { qualifier: 'main.speed' },
        { qualifier: 'GVL.alarm', direction: 'RO' },
      ],
    })

    expect(result.warnings).toEqual([])
    expect(read(result.files)).toEqual({
      enabled: true,
      clientName: 'vplc',
      clientId: 'id',
      clientSecret: 'secret',
      natsAddress: '172.18.0.1:49360',
      exports: [
        { qualifier: 'main.counter', direction: 'RW', arr: 0, elem: 3, datatype: 'DINT' },
        { qualifier: 'main.speed', direction: 'RO', arr: 0, elem: 4, datatype: 'REAL' },
        { qualifier: 'GVL.alarm', direction: 'RO', arr: 1, elem: 0, datatype: 'BOOL' },
      ],
    })
  })

  it('omits natsAddress when none was entered', () => {
    expect(read(generate({ ...ENABLED, exports: [] }).files)).not.toHaveProperty('natsAddress')
  })

  it('drops variables it cannot export and says why, without failing the build', () => {
    const result = generate({
      ...ENABLED,
      exports: [{ qualifier: 'main.missing' }, { qualifier: 'main.pos' }, { qualifier: 'other.counter' }],
    })

    expect(result.errors).toEqual([])
    expect(read(result.files).exports).toEqual([])
    expect(result.warnings).toEqual([
      'data-hub: main.missing is not in the compiled debug map; recompile after adding it to a POU or GVL',
      'data-hub: main.pos has datatype MY_STRUCT which is not exported yet',
      'data-hub: other.counter is not in the compiled debug map; recompile after adding it to a POU or GVL',
    ])
  })

  it('reports every variable as unresolved when the compile produced no debug map', () => {
    const result = generate({ ...ENABLED, exports: [{ qualifier: 'main.counter' }] }, '')
    expect(result.warnings).toEqual([
      'data-hub: main.counter is not in the compiled debug map; recompile after adding it to a POU or GVL',
    ])
  })

  it('warns about missing credentials and an address that is not host:port', () => {
    const result = generate({ enabled: true, natsAddress: 'nats://172.18.0.1', exports: [] })
    expect(result.warnings).toEqual([
      'data-hub: address nats://172.18.0.1 must be host:port, for example 172.18.0.1:49360',
      'data-hub: clientName is required when enabled',
      'data-hub: clientId is required when enabled',
      'data-hub: clientSecret is required when enabled',
    ])
  })

  it('writes nothing for a device that declares no screen configs', () => {
    const result = generateScreenConfigFiles({
      pluginName: 'weidmuller',
      packageId: PACKAGE_ID,
      screenConfigs: undefined,
      inputs: inputs(ENABLED),
    })
    expect(result).toEqual({ files: {}, warnings: [], errors: [] })
  })
})
