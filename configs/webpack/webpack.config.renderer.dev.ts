/**
 * Webpack dev config for the new src/ renderer.
 *
 * Extends the standard renderer dev config but swaps the entry point and
 * HTML template to use src/ instead of src_old/renderer/.
 * The main process, preload, DLL, and all build infrastructure remain identical.
 *
 * Usage: npm run start:dev
 */

import EslintPlugin from 'eslint-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import { join } from 'path'
import webpack from 'webpack'
import { mergeWithCustomize, customizeArray } from 'webpack-merge'

import rendererDevConfig from './webpack.config.renderer.old.dev'
import webpackPaths from './webpack.paths'

const port = process.env.PORT || 1313
const srcPath = join(webpackPaths.rootPath, 'src')

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { devServer: _devServer, ...rendererWithoutDevServer } = rendererDevConfig

const baseConfig = {
  ...rendererWithoutDevServer,
  module: { ...rendererDevConfig.module, rules: baseRules },
  plugins: basePlugins,
}

const srcOverrides: webpack.Configuration = {
  entry: [
    `webpack-dev-server/client?http://localhost:${port}/dist`,
    'webpack/hot/only-dev-server',
    join(srcPath, 'main.tsx'),
  ],

  devServer: {
    port,
    compress: true,
    hot: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
    static: { publicPath: '/' },
    historyApiFallback: { verbose: true },
    // No setupMiddlewares — start:electron handles main process separately.
  },

  resolve: {
    alias: {
      '@src': join(webpackPaths.rootPath, 'src'),
    },
  },

  plugins: [
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: join(srcPath, 'index.ejs'),
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
})(baseConfig, srcOverrides)
