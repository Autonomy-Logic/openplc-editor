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

const port = process.env.PORT || 1313
const src2Path = join(webpackPaths.rootPath, 'src2')

// Remove the base HtmlWebpackPlugin and EslintPlugin so we can replace/skip them
const basePlugins = (rendererDevConfig.plugins ?? []).filter(
  (p) => !(p instanceof HtmlWebpackPlugin) && !(p instanceof EslintPlugin),
)

// Remove the duplicate bare ts-loader rule (/\.ts?$/) from the renderer config.
// The base config already handles .ts files via /\.[jt]sx?$/ with transpileOnly + module:'esnext'.
// The duplicate causes double-compilation: the bare ts-loader uses tsconfig's module:"commonjs",
// injecting `exports.xxx` references that are undefined in webpack's module scope.
const baseRules = (rendererDevConfig.module?.rules ?? []).filter((r) => {
  if (r && typeof r === 'object' && 'test' in r && r.test instanceof RegExp) {
    return r.test.toString() !== '/\\.ts?$/'
  }
  return true
})

const baseConfig = {
  ...rendererDevConfig,
  module: { ...rendererDevConfig.module, rules: baseRules },
  plugins: basePlugins,
}

const src2Overrides: webpack.Configuration = {
  entry: [
    `webpack-dev-server/client?http://localhost:${port}/dist`,
    'webpack/hot/only-dev-server',
    join(src2Path, 'main.tsx'),
  ],

  devServer: {
    port,
  },

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
