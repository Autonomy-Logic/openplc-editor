/**
 * Webpack config for production electron main process
 */

import { existsSync } from 'fs'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import { join } from 'path'
import TerserPlugin from 'terser-webpack-plugin'
import webpack from 'webpack'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import { merge } from 'webpack-merge'

import checkNodeEnv from '../../scripts/check-node-env'
import deleteSourceMaps from '../../scripts/delete-source-maps'
import baseConfig from './webpack.config.base'
import webpackPaths from './webpack.paths'

checkNodeEnv('production')
deleteSourceMaps()

/** The committed trust module, replaced in the bundle by the one `scripts/package-trust/cli.ts prepare` placed. */
const committedTrustModule = join(webpackPaths.srcPath, 'backend', 'editor', 'package-trust', 'package-trust-anchor.ts')
const placedTrustModule = join(webpackPaths.releasePath, 'package-trust', 'package-trust-anchor.ts')
if (!existsSync(placedTrustModule)) {
  throw new Error(
    `${placedTrustModule} is missing: run "ts-node --transpile-only scripts/package-trust/cli.ts prepare" before webpack`,
  )
}
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const configuration: webpack.Configuration = {
  devtool: 'source-map',

  mode: 'production',

  target: 'electron-main',

  entry: {
    // `entry.ts`, not `main.ts`: a packaged Electron app always runs
    // `package.json.main`, so the GUI and the headless CLI (DOPE-567) have to
    // ship in one binary with argv deciding which starts. It imports the GUI
    // only when this is not a `--cli` run.
    main: join(webpackPaths.srcMainPath, 'entry.ts'),
    preload: join(webpackPaths.srcMainPath, 'modules/preload/preload.ts'),
    'clang-worker': join(webpackPaths.srcPath, 'backend/editor/wasm-toolchain/clang-worker.ts'),
  },

  output: {
    path: webpackPaths.distMainPath,
    filename: '[name].js',
    library: {
      type: 'umd',
    },
  },

  optimization: {
    minimizer: [
      new TerserPlugin({
        parallel: true,
      }),
    ],
  },

  plugins: [
    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
      analyzerPort: 8888,
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
      NODE_ENV: 'production',
      DEBUG_PROD: false,
      START_MINIMIZED: false,
    }),
    new HtmlWebpackPlugin({
      filename: join('splash.html'),
      template: join(webpackPaths.srcMainPath, 'modules', 'preload', 'splash-screen', 'splash.html'),
      isBrowser: false,
      isDevelopment: false,
    }),

    new webpack.DefinePlugin({
      'process.type': '"browser"',
    }),

    new webpack.NormalModuleReplacementPlugin(new RegExp(`^${escapeRegExp(committedTrustModule)}$`), placedTrustModule),
  ],

  /**
   * Disables webpack processing of __dirname and __filename.
   * If you run the bundle in node.js it falls back to these values of node.js.
   * https://github.com/webpack/webpack/issues/2010
   */
  node: {
    __dirname: false,
    __filename: false,
  },
}

export default merge(baseConfig, configuration)
