/**
 * Webpack dev config for the src2/ migration renderer.
 *
 * Extends the standard renderer dev config but swaps the entry point and
 * HTML template to use src2/ instead of src/renderer/.
 * The main process, preload, DLL, and all build infrastructure remain identical.
 *
 * Usage: npm run start:src2
 */

import EslintPlugin from 'eslint-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import { join } from 'path'
import webpack from 'webpack'
import { mergeWithCustomize, customizeArray } from 'webpack-merge'

import rendererDevConfig from './webpack.config.renderer.dev'
import webpackPaths from './webpack.paths'

const port = process.env.PORT || 1212
const src2Path = join(webpackPaths.rootPath, 'src2')

// Remove the base HtmlWebpackPlugin and EslintPlugin so we can replace/skip them
const basePlugins = (rendererDevConfig.plugins ?? []).filter(
  (p) => !(p instanceof HtmlWebpackPlugin) && !(p instanceof EslintPlugin),
)
const baseConfig = { ...rendererDevConfig, plugins: basePlugins }

const src2Overrides: webpack.Configuration = {
  entry: [
    `webpack-dev-server/client?http://localhost:${port}/dist`,
    'webpack/hot/only-dev-server',
    join(src2Path, 'main.tsx'),
  ],

  resolve: {
    alias: {
      '@src2': join(webpackPaths.rootPath, 'src2'),
    },
  },

  plugins: [
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: join(src2Path, 'index.ejs'),
      minify: {
        collapseWhitespace: true,
        removeAttributeQuotes: true,
        removeComments: true,
      },
      isBrowser: false,
      env: process.env.NODE_ENV,
      isDevelopment: process.env.NODE_ENV !== 'production',
      nodeModules: webpackPaths.appNodeModulesPath,
    }),
  ],
}

export default mergeWithCustomize({
  customizeArray: customizeArray({
    entry: 'replace',
  }),
})(baseConfig, src2Overrides)
