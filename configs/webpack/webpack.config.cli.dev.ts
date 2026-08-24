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

  // `entry.ts` reaches both roles through dynamic imports, which webpack would
  // split into sibling chunk files next to this bundle in the repo root. Folded
  // back into the one file instead — the point of this config is a single
  // artifact you can hand to `electron`.
  plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
}

const merged = merge(devMainConfig, configuration)

export default {
  ...merged,
  // Assigned after the merge: webpack-merge UNIONS `entry` objects, so the dev
  // main build's entries would survive an override expressed inside the merge.
  // `entry.ts`, NOT `cli/main.ts` — the same entry the packaged binary runs.
  //
  // Entering at `cli/main.ts` skipped the argv dispatcher, and with it two
  // things that only exist there: the Linux re-exec that supplies the headless
  // Chromium switches, and the handler that turns a failure to LOAD the CLI
  // into an exit instead of a modal error dialog nobody can click. Both were
  // therefore untestable with the bundle used to test everything else — a dev
  // build that starts differently from the shipped one is a dev build that can
  // pass while the product hangs. Costs `--cli` on every dev invocation, which
  // is what the packaged binary needs anyway.
  entry: { 'openplc-cli.dev': `${webpackPaths.srcPath}/main/entry.ts` },
}
