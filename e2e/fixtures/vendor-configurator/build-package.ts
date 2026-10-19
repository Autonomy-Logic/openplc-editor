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
export const CONFIGURATOR_SCREEN = 'I/O Configurator'
export const MAPPING_SCREEN = 'I/O Mapping'

const HERE = __dirname
const REPO = join(HERE, '..', '..', '..')

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
          hal: { type: 'plugin' },
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
