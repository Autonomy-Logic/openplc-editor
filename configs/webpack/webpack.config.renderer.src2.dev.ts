/**
 * Webpack dev config for the src2/ migration renderer.
 *
 * Extends the standard renderer dev config but swaps the entry point and
 * HTML template to use src2/renderer/ instead of src/renderer/.
 * The main process, preload, DLL, and all build infrastructure remain identical.
 *
 * Usage: npm run start:src2
 */

import HtmlWebpackPlugin from 'html-webpack-plugin'
import { join } from 'path'
import webpack from 'webpack'
import { merge } from 'webpack-merge'

import rendererDevConfig from './webpack.config.renderer.dev'
import webpackPaths from './webpack.paths'

const port = process.env.PORT || 1212
const src2RendererPath = join(webpackPaths.rootPath, 'src2', 'renderer')

const src2Overrides: webpack.Configuration = {
  entry: [
    `webpack-dev-server/client?http://localhost:${port}/dist`,
    'webpack/hot/only-dev-server',
    join(src2RendererPath, 'index.tsx'),
  ],

  resolve: {
    alias: {
      '@src2': join(webpackPaths.rootPath, 'src2'),
    },
  },

  plugins: [
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: join(src2RendererPath, 'index.ejs'),
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

export default merge(rendererDevConfig, src2Overrides)
