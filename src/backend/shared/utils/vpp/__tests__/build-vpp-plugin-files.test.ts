import { createHash } from 'node:crypto'

import { describe, expect, it } from '@jest/globals'

import { buildVppPluginFiles, type VppDevice } from '../build-vpp-plugin-files'

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const text = (value: string): Uint8Array => new TextEncoder().encode(value)
const read = (files: Record<string, Uint8Array>, path: string): string =>
  new TextDecoder().decode(files[path])

const SIGNATURE = {
  formatVersion: '1.0',
  alg: 'ed25519',
  keyId: 'openplc-2026',
  packageId: 'com.synergy-logic.slm-rp4',
  version: '0.3.1',
  signedAt: '2026-09-01T00:00:00.000Z',
  files: { 'manifest.json': 'aa' },
}

function makeDevice(overrides: Partial<VppDevice> = {}): VppDevice {
  return {
    id: 'slm-rp4',
    name: 'SLM-RP4',
    preview: 'assets/board.png',
    target: { type: 'runtime-v4' },
    hal: {
      type: 'runtime-v4',
      pluginEntry: 'hal/plugin/main.cpp',
      configTemplate: 'hal/plugin/config_template.json',
    },
    ...overrides,
  } as VppDevice
}

function makePackageFiles(extra: Record<string, string> = {}): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>([
    ['manifest.json', text('{}')],
    ['hal/plugin/config_template.json', text(JSON.stringify({ plugin_name: 'synergy', baud: 9600 }))],
    ['hal/plugin/main.cpp', text('int main(){}\n')],
    ['hal/plugin/Makefile', text('all:\n\t$(CC) main.cpp\n')],
    ['hal/plugin/requirements.txt', text('pyserial\n')],
  ])
  for (const [name, content] of Object.entries(extra)) files.set(name, text(content))
  return files
}

describe('buildVppPluginFiles', () => {
  it('writes exactly the desktop writer file set', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles(),
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      sha256Hex,
    })

    expect(result.errors).toEqual([])
    expect(Object.keys(result.files).sort()).toEqual([
      'conf/synergy.json',
      'vpp_plugin/Makefile',
      'vpp_plugin/checksum.sha256',
      'vpp_plugin/main.cpp',
      'vpp_plugins.conf',
      'vpp_signature.json',
    ])
    expect(result.pluginName).toBe('synergy')
  })

  it('writes vpp_plugins.conf in the exact format the runtime parses', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles(),
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      sha256Hex,
    })

    expect(read(result.files, 'vpp_plugins.conf')).toBe(
      'synergy,./build/vpp/libsynergy_plugin.so,1,1,./build/vpp/synergy.json,\n',
    )
  })

  it('computes checksum.sha256 the way compile.sh expects', async () => {
    const files = makePackageFiles()
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: files,
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      sha256Hex,
    })

    // "<sha256>  <relative-path>\n" per file, sorted, then a sha256 of that listing.
    const listing =
      `${sha256Hex(files.get('hal/plugin/Makefile') as Uint8Array)}  Makefile\n` +
      `${sha256Hex(files.get('hal/plugin/main.cpp') as Uint8Array)}  main.cpp\n`
    expect(read(result.files, 'vpp_plugin/checksum.sha256')).toBe(`${sha256Hex(text(listing))}\n`)
  })

  it('drops the editor-only files from the plugin tree', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles(),
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      sha256Hex,
    })

    expect(result.files['vpp_plugin/config_template.json']).toBeUndefined()
    expect(result.files['vpp_plugin/requirements.txt']).toBeUndefined()
  })

  it('forwards the package signature with the signed subtree it attests to', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles(),
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      sha256Hex,
    })

    expect(read(result.files, 'vpp_signature.json')).toBe(
      `${JSON.stringify({ package: SIGNATURE, pluginDir: 'hal/plugin' }, null, 2)}\n`,
    )
  })

  it('warns instead of failing when the package is unsigned', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles(),
      packageSignature: null,
      vendorScreenData: {},
      sha256Hex,
    })

    expect(result.files['vpp_signature.json']).toBeUndefined()
    expect(result.warnings.join('\n')).toContain('no usable signature.json')
  })

  it('includes a generated trusted-keys unit in the tree and the checksum', async () => {
    const withoutKeys = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles(),
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      sha256Hex,
    })
    const withKeys = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles(),
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      trustedKeysC: 'const unsigned char LIC_TRUSTED_KEYS[] = {0};\n',
      sha256Hex,
    })

    expect(read(withKeys.files, 'vpp_plugin/trusted_keys.c')).toContain('LIC_TRUSTED_KEYS')
    // A key rotation with unchanged sources must still move the checksum, or
    // compile.sh would skip the rebuild on the device.
    expect(read(withKeys.files, 'vpp_plugin/checksum.sha256')).not.toBe(
      read(withoutKeys.files, 'vpp_plugin/checksum.sha256'),
    )
  })

  it('treats a prebuilt pluginEntry as the directory itself', async () => {
    const files = makePackageFiles({
      'hal/prebuilt/driver.o': 'binary',
      'hal/prebuilt/Makefile': 'link:\n',
    })
    const result = await buildVppPluginFiles({
      device: makeDevice({
        hal: {
          type: 'runtime-v4',
          provisioning: 'prebuilt',
          pluginEntry: 'hal/prebuilt',
          configTemplate: 'hal/plugin/config_template.json',
        },
      } as Partial<VppDevice>),
      packageFiles: files,
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      sha256Hex,
    })

    expect(Object.keys(result.files)).toContain('vpp_plugin/driver.o')
    expect(read(result.files, 'vpp_signature.json')).toContain('"pluginDir": "hal/prebuilt"')
  })

  it('refuses a plugin_name that would place the config outside conf/', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles({
        'hal/plugin/config_template.json': JSON.stringify({ plugin_name: '../../../etc/cron.d/runme' }),
      }),
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      sha256Hex,
    })

    expect(result.errors.join('\n')).toContain('Invalid configTemplate.plugin_name')
    expect(result.files).toEqual({})
  })

  it('packs nothing for a board that is not runtime-v4', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice({ target: { type: 'arduino-cli', platform: 'esp32:esp32' } } as Partial<VppDevice>),
      packageFiles: makePackageFiles(),
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      sha256Hex,
    })

    expect(result.files).toEqual({})
    expect(result.warnings.join('\n')).toContain('not runtime-v4')
  })

  it('fails when the manifest names a config template the package does not contain', async () => {
    const files = makePackageFiles()
    files.delete('hal/plugin/config_template.json')

    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: files,
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      sha256Hex,
    })

    expect(result.errors.join('\n')).toContain('config template not found')
  })

  it('merges vendor screen values into the generated config', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles(),
      packageSignature: SIGNATURE,
      vendorScreenData: { general: { baud: 115200, label: 'line-a' } },
      sha256Hex,
    })

    const config = JSON.parse(read(result.files, 'conf/synergy.json')) as Record<string, unknown>
    expect(config).toMatchObject({ plugin_name: 'synergy', baud: 115200, label: 'line-a' })
  })

  it('drops prototype keys a package tries to merge into the config', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles({
        'hal/plugin/config_template.json': '{"plugin_name":"synergy","__proto__":{"polluted":true}}',
      }),
      packageSignature: SIGNATURE,
      vendorScreenData: { evil: JSON.parse('{"__proto__":{"pollutedToo":true}}') as Record<string, unknown> },
      sha256Hex,
    })

    const config = JSON.parse(read(result.files, 'conf/synergy.json')) as Record<string, unknown>
    expect(Object.keys(config)).not.toContain('__proto__')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).pollutedToo).toBeUndefined()
  })

  it('warns at pack time when the installed package moved since the project pinned it', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles(),
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      pin: {
        recorded: { packageId: 'com.synergy-logic.slm-rp4', version: '0.3.1', contentHash: 'sha256:old' },
        installed: { packageId: 'com.synergy-logic.slm-rp4', version: '0.3.1', contentHash: 'sha256:new' },
      },
      sha256Hex,
    })

    // Warned, not refused: the user may have meant to rebuild against the new
    // package, and the bundle is still coherent.
    expect(result.warnings.join('\n')).toContain('republished')
    expect(Object.keys(result.files)).toContain('vpp_plugins.conf')
  })

  it('says nothing at pack time for a project that predates pinning', async () => {
    const result = await buildVppPluginFiles({
      device: makeDevice(),
      packageFiles: makePackageFiles(),
      packageSignature: SIGNATURE,
      vendorScreenData: {},
      pin: {
        installed: { packageId: 'com.synergy-logic.slm-rp4', version: '0.3.1', contentHash: 'sha256:new' },
      },
      sha256Hex,
    })

    expect(result.warnings).toEqual([])
  })
})
