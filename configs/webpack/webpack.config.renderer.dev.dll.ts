/**
 * Builds the DLL for development electron renderer process
 */

import ESLintPlugin from 'eslint-webpack-plugin'
import { join } from 'path'
import webpack from 'webpack'
import { merge } from 'webpack-merge'

import { dependencies } from '../../package.json'
import checkNodeEnv from '../../scripts/check-node-env'
import baseConfig from './webpack.config.base'
import webpackPaths from './webpack.paths'

checkNodeEnv('development')

const dist = webpackPaths.dllPath

const configuration: webpack.Configuration = {
  context: webpackPaths.rootPath,

  devtool: 'eval',

  mode: 'development',

  target: 'electron-renderer',

  externals: ['fsevents', 'crypto-browserify'],

  /**
   * Use `module` from `webpack.config.renderer.dev.js`
   */
   
  module: require('./webpack.config.renderer.dev').default.module,

  entry: {
    // Pre-bundle every runtime dependency into the dev DLL for faster
    // renderer rebuilds.  Exclude packages that have no resolvable
    // top-level entry (`main`/`module`/`exports`) — webpack errors
    // out trying to bundle them as renderer entries even though our
    // source code only consumes them via subpath imports (e.g.
    // `browser-basedpyright` ships only the worker bundle under
    // `dist/` and is loaded through `?url`).
    //
    // `pdfjs-dist` DOES resolve (it has `main`), but must be excluded for a
    // different reason: we `import('pdfjs-dist')` for its main-thread API
    // *and* load `pdf.worker.min.mjs` separately via `?url` as an
    // independent Worker. Pre-bundling the main API into the DLL creates a
    // second, separate module instantiation of pdf.js alongside the one in
    // the renderer bundle, which breaks the API/Worker handshake pdf.js
    // relies on internally — surfaces as cryptic runtime errors deep in the
    // worker (e.g. a hash helper missing a method during fingerprint
    // computation), not a load failure. Same class of problem as the
    // browser-basedpyright exclusion above, different root cause.
    renderer: Object.keys(dependencies || {}).filter((name) => name !== 'browser-basedpyright' && name !== 'pdfjs-dist'),
  },

  output: {
    path: dist,
    filename: '[name].dev.dll.js',
    library: {
      name: 'renderer',
      type: 'var',
    },
  },

  plugins: [
    new webpack.DllPlugin({
      path: join(dist, '[name].json'),
      name: '[name]',
    }),

    /**
     * Create global constants which can be configured at compile time.
     *
     * Useful for allowing different behaviour between development builds and
     * release builds
     *
     * NODE_ENV should be production so that modules do not perform certain
     * development checks
     */
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development',
    }),

    new webpack.LoaderOptionsPlugin({
      debug: true,
      options: {
        context: webpackPaths.srcPath,
        output: {
          path: webpackPaths.dllPath,
        },
      },
    }),
    new ESLintPlugin({
      configType: 'flat',
      extensions: ['ts', 'tsx'],
      eslintPath: 'eslint/use-at-your-own-risk',
    }),
  ],
}

export default merge(baseConfig, configuration)
