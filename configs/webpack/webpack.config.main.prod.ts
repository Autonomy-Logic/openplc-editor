/**
 * Webpack config for production electron main process
 */

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

// Version compatibility check and cleanup
const fs = require('fs')
const path = require('path')

const packageJson = require('../../package.json')
const currentVersion = packageJson.version
const configDir = webpackPaths.distMainPath

// Check for incompatible artifacts from newer versions
const checkAndCleanIncompatibleArtifacts = () => {
  try {
    const versionFile = path.join(configDir, '.version')
    if (fs.existsSync(versionFile)) {
      const installedVersion = fs.readFileSync(versionFile, 'utf8').trim()
      if (installedVersion > currentVersion) {
        console.warn(`Warning: Installed version (${installedVersion}) is newer than current version (${currentVersion}). Cleaning up incompatible artifacts.`)
        // Remove incompatible configuration files
        const filesToRemove = [
          'main.js',
          'preload.js',
          '.version'
        ]
        filesToRemove.forEach(file => {
          const filePath = path.join(configDir, file)
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
          }
        })
      }
    }
  } catch (error) {
    console.warn('Could not perform version compatibility check:', error.message)
  }
}

checkAndCleanIncompatibleArtifacts()

const configuration: webpack.Configuration = {
  devtool: 'source-map',

  mode: 'production',

  target: 'electron-main',

  entry: {
    main: join(webpackPaths.srcMainPath, 'main.ts'),
    preload: join(webpackPaths.srcMainPath, 'modules/preload/preload.ts'),
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
