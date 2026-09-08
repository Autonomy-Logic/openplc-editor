/**
 * Webpack dev config for the src/ renderer.
 *
 * Usage: npm run start:dev
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
      // Override for the editor's VPP catalog backend host.  Falsy
      // (empty string) when the dev shell doesn't set it — the
      // adapter (`package-adapter.ts`) then falls back to the
      // production default hardcoded there.  Set the env BEFORE
      // `npm run dev` to point at staging or localhost:
      //   `VPP_CATALOG_URL=http://localhost:3333 npm run dev`
      VPP_CATALOG_URL: '',
      // Same mechanism for the Edge WEB app (the `/buy` license page), which is
      // a DIFFERENT origin from the API above.  Falls back to the production
      // host hardcoded in `system-adapter.ts` when unset:
      //   `OPENPLC_EDGE_WEB_URL=http://localhost:5173 npm run dev`
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
      // `python` covers the Python POU editor; `json` covers the
      // Library Project's manifest tab (`library.json`).  Without
      // `json` here, opening the manifest tab spawns a worker with
      // no asset registered, which surfaces as an unhandled Worker
      // `error` event in the renderer console.
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
        // Compile errors and warnings still get an overlay: those are the ones
        // worth interrupting for, and they are what this overlay is good at.
        errors: true,
        warnings: true,
        // Runtime errors do NOT, and it cannot be a filter instead.
        //
        // The reason to want one: Monaco cancels pending work by rejecting with
        // an error it names `Canceled`, and every disposed editor leaves one
        // behind for whichever debounced contribution was still armed. Nothing
        // is wrong — cancellation is what disposal means — but it reaches
        // `window` as an unhandled rejection, and a full-screen overlay sits
        // above everything and swallows every click until dismissed. Reloading
        // a project from the source-control panel left the app looking frozen.
        //
        // Why not a filter function, which is what webpack-dev-server offers
        // and what this used to be: the option is serialized into the client's
        // own URL as a STRING, and `decodeOverlayOptions` revives it with
        // `new Function`. The renderer's CSP is `script-src 'self'
        // 'unsafe-inline'` (see `src/index.ejs`), so that throws an EvalError
        // while the dev-server client module is still initialising — which
        // takes the whole bundle down and boots the app to a white screen.
        // A boolean is not serialized as a string and never reaches `eval`.
        //
        // Why not suppress it from the app instead: the client registers its
        // `unhandledrejection` listener at module init, before any of our code
        // runs, so `preventDefault` cannot reach it and neither can
        // `stopImmediatePropagation` — the listener that runs first wins, and
        // ours is second by construction.
        //
        // What is lost: a genuine runtime error no longer raises an overlay in
        // dev. It still reaches the console and the Electron DevTools, which is
        // where this app is debugged anyway. `installMonacoCancellationGuard`
        // in `main.tsx` keeps the cancellation itself out of the console.
        runtimeErrors: false,
      },
    },
  },
}

export default merge(baseConfig, configuration)
