/**
 * Webpack dev config for the src/ renderer. Usage: npm run start:dev
 */

import 'webpack-dev-server'

import ReactRefreshWebpackPlugin from '@pmmmwh/react-refresh-webpack-plugin'
import autoprefixer from 'autoprefixer'
import chalk from 'chalk'
import { execSync } from 'child_process'
import fs from 'fs'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import MonacoEditorWebpackPlugin from 'monaco-editor-webpack-plugin'
import { join, resolve } from 'path'
import tailwindcss from 'tailwindcss'
import webpack from 'webpack'
import { merge } from 'webpack-merge'

import checkNodeEnv from '../../scripts/check-node-env'
import { getAppInfoDefines } from './webpack.app-info'
import baseConfig from './webpack.config.base'
import webpackPaths from './webpack.paths'

// When an ESLint server is running, we can't set the NODE_ENV so we'll check if it's
// at the dev webpack config is not accidentally run in a production environment
if (process.env.NODE_ENV === 'production') {
  checkNodeEnv('development')
}

const port = process.env.PORT || 1313
const manifest = resolve(webpackPaths.dllPath, 'renderer.json')
const skipDLLs =
  module.parent?.filename.includes('webpack.config.renderer.dev.dll') ||
  module.parent?.filename.includes('webpack.config.eslint')

/**
 * Warn if the DLL is not built
 */
if (!skipDLLs && !(fs.existsSync(webpackPaths.dllPath) && fs.existsSync(manifest))) {
  console.log(
    chalk.black.bgYellow.bold(
      'The DLL files are missing. Sit back while we build them for you with "npm run build-dll"',
    ),
  )
  execSync('npm run postinstall')
}

const srcPath = join(webpackPaths.rootPath, 'src')

const configuration: webpack.Configuration = {
  devtool: 'inline-source-map',

  mode: 'development',

  target: ['web', 'electron-renderer'],

  entry: [
    `webpack-dev-server/client?http://localhost:${port}/dist`,
    'webpack/hot/only-dev-server',
    join(srcPath, 'main.tsx'),
  ],

  output: {
    path: webpackPaths.distRendererPath,
    publicPath: '/',
    filename: 'renderer.dev.js',
    library: {
      type: 'umd',
    },
  },

  module: {
    rules: [
      {
        test: /\.s?(c|a)ss$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              modules: true,
              sourceMap: true,
              importLoaders: 1,
            },
          },
          'sass-loader',
        ],
        include: /\.module\.s?(c|a)ss$/,
      },
      {
        test: /\.s?css$/,
        use: [
          'style-loader',
          'css-loader',
          'sass-loader',
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                plugins: [tailwindcss, autoprefixer],
              },
            },
          },
        ],
        exclude: /\.module\.s?(c|a)ss$/,
      },
      // Fonts
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
      // Static JS assets — used by the STruC++ LSP worker.  See
      // webpack.config.renderer.prod.ts for the same rule + rationale.
      {
        resourceQuery: /^\?url$/,
        type: 'asset/resource',
      },
      // Images
      {
        test: /\.(png|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
      },
      // SVG
      {
        test: /\.svg$/,
        use: [
          {
            loader: '@svgr/webpack',
            options: {
              prettier: false,
              svgo: false,
              svgoConfig: {
                plugins: [{ removeViewBox: false }],
              },
              titleProp: true,
              ref: true,
            },
          },
          'file-loader',
        ],
      },
    ],
  },

  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@src': srcPath,
    },
  },

  plugins: [
    ...(skipDLLs
      ? []
      : [
          new webpack.DllReferencePlugin({
            context: webpackPaths.dllPath,
            manifest: require(manifest),
            sourceType: 'var',
          }),
        ]),

    new webpack.NoEmitOnErrorsPlugin(),

    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development',
      // Empty falls back to the production host in package-adapter.ts; set before
      // `npm run dev` to override, e.g. VPP_CATALOG_URL=http://localhost:3333.
      VPP_CATALOG_URL: '',
      // Same mechanism for the Edge WEB app (`/buy` license page), a different origin;
      // falls back to the host in system-adapter.ts, e.g. OPENPLC_EDGE_WEB_URL=http://localhost:5173.
      OPENPLC_EDGE_WEB_URL: '',
    }),

    new webpack.DefinePlugin({
      ...getAppInfoDefines(),
    }),

    new webpack.LoaderOptionsPlugin({
      options: {},
      debug: true,
    }),

    new ReactRefreshWebpackPlugin(),

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

    new MonacoEditorWebpackPlugin({
      // `json` covers the Library Project's manifest tab; without it, opening that
      // tab spawns a worker with no asset registered, erroring in the console.
      languages: ['python', 'json'],
    }),
  ],

  node: {
    __dirname: false,
    __filename: false,
  },

  devServer: {
    port,
    compress: true,
    hot: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
    static: { publicPath: '/' },
    historyApiFallback: { verbose: true },
    client: {
      overlay: {
        errors: true,
        warnings: true,
        // Must be a boolean, not a filter fn: a filter is serialized into the dev-server client URL and revived with `new Function`, which the renderer CSP blocks.
        runtimeErrors: false,
      },
    },
  },
}

export default merge(baseConfig, configuration)
