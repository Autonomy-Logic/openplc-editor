/**
 * Development build of the headless CLI.
 *
 * Two things make this a config of its own rather than another entry on the dev
 * main build, and both are path resolution rather than bundling:
 *
 *   - `NODE_ENV=development`, because `CompilerModule` chooses between
 *     `process.cwd()/resources` and `process.resourcesPath` from it, and that
 *     choice is baked in at build time. A production-built CLI run from a dev
 *     checkout looks for arduino-cli inside Electron.app and fails with ENOENT.
 *   - Output at the REPO ROOT, because Electron sets `app.getAppPath()` to the
 *     directory of the script it is handed, and the compiler resolves the
 *     STruC++ runtime headers as `getAppPath()/node_modules/strucpp/...`. The
 *     dev GUI is launched as `electron .` from the root, so the root is what
 *     the GUI resolves — and matching it is the whole point of the CLI.
 *
 * The packaged CLI has neither problem: `app.isPackaged` sends every one of
 * these lookups to `process.resourcesPath`.
 */

import webpack from 'webpack'
import { merge } from 'webpack-merge'

import devMainConfig from './webpack.config.main.dev'
import webpackPaths from './webpack.paths'

const configuration: webpack.Configuration = {
  output: {
    path: webpackPaths.rootPath,
    filename: '[name].js',
    library: { type: 'umd' },
  },

  // One file, no chunks. Both matter because the output directory is the repo
  // ROOT: merging would keep the dev main build's `main`/`preload` entries and
  // emit them here too, and code splitting would scatter vendor chunks
  // alongside them — which is exactly the litter this replaced.
  optimization: { splitChunks: false, runtimeChunk: false },
}

const merged = merge(devMainConfig, configuration)

export default {
  ...merged,
  // Assigned after the merge: webpack-merge UNIONS `entry` objects, so the dev
  // main build's entries would survive an override expressed inside the merge.
  entry: { 'openplc-cli.dev': `${webpackPaths.srcPath}/cli/main.ts` },
}
