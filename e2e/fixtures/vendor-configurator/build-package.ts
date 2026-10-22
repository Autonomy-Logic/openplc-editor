/**
 * Installs an unsigned e2e vendor package whose `UC20-M3000` board carries the configurator and
 * I/O Mapping screens, with the fake Device Editor bundled as `configurator/index.js` next to the
 * reference relay. The editor removes unsigned packages when a project opens, so a suite using it
 * must stub `packages:verify-signatures` first.
 */

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import webpack from 'webpack'

export const FIXTURE_PACKAGE_ID = 'com.e2e.fake-configurator'
export const FIXTURE_BOARD = 'UC20-M3000'
export const CONFIGURATOR_SCREEN = 'Backplane Configuration'
export const MAPPING_SCREEN = 'I/O Mapping'

const HERE = __dirname
const REPO = join(HERE, '..', '..', '..')

type Channel = {
  name: string
  type: string
  dataType: string
  addressPrefix: string
  wire: { byte: number; bit?: number }
}

const bit = (name: string, input: boolean, byte: number, bitIndex: number): Channel => ({
  name,
  type: input ? 'digitalInput' : 'digitalOutput',
  dataType: 'BOOL',
  addressPrefix: input ? '%IX' : '%QX',
  wire: { byte, bit: bitIndex },
})

const scalar = (name: string, input: boolean, dataType: string, size: string, byte: number): Channel => ({
  name,
  type: input ? 'analogInput' : 'analogOutput',
  dataType,
  addressPrefix: `%${input ? 'I' : 'Q'}${size}`,
  wire: { byte },
})

const fakeModule = (typeId: string, inputBytes: number, outputBytes: number, channels: Channel[]) => ({
  id: typeId.toLowerCase(),
  name: typeId,
  typeId,
  processImage: { inputBytes, outputBytes },
  io: {
    digitalInputs: channels.filter((channel) => channel.type === 'digitalInput').length,
    digitalOutputs: channels.filter((channel) => channel.type === 'digitalOutput').length,
    analogInputs: channels.filter((channel) => channel.type === 'analogInput').length,
    analogOutputs: channels.filter((channel) => channel.type === 'analogOutput').length,
  },
  addressMapping: { baseAddressType: 'auto', channels },
})

/** Catalogue for the fake Device Editor's module types, following the package catalogue rules. */
export const FIXTURE_MODULES = [
  fakeModule('FAKE-4DI', 2, 0, [
    ...[0, 1, 2, 3].map((i) => bit(`DI.${i}`, true, 0, i)),
    scalar('status', true, 'USINT', 'B', 1),
  ]),
  fakeModule('FAKE-4DO', 0, 2, [...[0, 1, 2, 3].map((i) => bit(`DO.${i}`, false, 0, i)), bit('enable', false, 1, 3)]),
  fakeModule('FAKE-2AI', 12, 0, [
    scalar('AI0', true, 'INT', 'W', 0),
    scalar('AI1', true, 'INT', 'W', 2),
    scalar('counter', true, 'DINT', 'D', 4),
    scalar('temperature', true, 'REAL', 'D', 8),
  ]),
  fakeModule('FAKE-MIX', 0, 3, [scalar('setpoint', false, 'USINT', 'B', 0), scalar('mode', false, 'INT', 'W', 1)]),
]

const PREVIEW_PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
)

/** Bundles the two guest entries into `outDir/relay.js` and `outDir/index.js`. */
export function bundleGuestScripts(outDir: string): Promise<void> {
  const compiler = webpack({
    mode: 'development',
    devtool: false,
    target: 'web',
    context: HERE,
    entry: { relay: './guest-relay.ts', index: './guest-device-editor.ts' },
    output: { path: outDir, filename: '[name].js' },
    resolve: { extensions: ['.ts', '.js'] },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'ts-loader',
          options: { transpileOnly: true, configFile: join(REPO, 'tsconfig.json') },
        },
      ],
    },
  })
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close(() => undefined)
      if (error) return reject(error)
      if (stats?.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })))
      resolve()
    })
  })
}

/**
 * Writes the package under `packagesDir` from scripts already bundled into `bundleDir`, and a
 * `registry.json` listing only it.
 */
export function installFixturePackage(packagesDir: string, bundleDir: string): string {
  const root = join(packagesDir, FIXTURE_PACKAGE_ID)
  mkdirSync(join(root, 'configurator'), { recursive: true })
  mkdirSync(join(root, 'screens'), { recursive: true })

  copyFileSync(join(HERE, 'index.html'), join(root, 'configurator', 'index.html'))
  copyFileSync(join(bundleDir, 'relay.js'), join(root, 'configurator', 'relay.js'))
  copyFileSync(join(bundleDir, 'index.js'), join(root, 'configurator', 'index.js'))
  for (const screen of ['io-configurator.json', 'io-mapping.json']) {
    copyFileSync(join(REPO, 'src', '__fixtures__', 'weidmuller-screens', screen), join(root, 'screens', screen))
  }
  writeFileSync(join(root, 'preview.png'), PREVIEW_PNG)
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      formatVersion: '1.0',
      package: { id: FIXTURE_PACKAGE_ID, name: 'E2E Fake Configurator', version: '1.0.0', vendor: { name: 'E2E' } },
      devices: [
        {
          id: 'fake-uc20',
          name: FIXTURE_BOARD,
          preview: 'preview.png',
          target: { type: 'runtime-v4' },
          hal: { type: 'plugin', pluginConfigFormat: 'io-ranges' },
          moduleSystem: { enabled: true, maxSlots: 64, modules: FIXTURE_MODULES },
          screens: {
            [CONFIGURATOR_SCREEN]: 'screens/io-configurator.json',
            [MAPPING_SCREEN]: 'screens/io-mapping.json',
          },
        },
      ],
    }),
  )
  writeFileSync(
    join(packagesDir, 'registry.json'),
    JSON.stringify({
      formatVersion: '1.0',
      packages: {
        [FIXTURE_PACKAGE_ID]: {
          version: '1.0.0',
          installedAt: new Date().toISOString(),
          path: root,
          devices: ['fake-uc20'],
        },
      },
    }),
  )
  return root
}
