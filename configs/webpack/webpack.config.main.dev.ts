/**
 * Webpack config for development electron main process (new src)
 *
 * Builds from src/main/. All @root imports resolve to src/.
 */

import { join } from 'path'
import webpack from 'webpack'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import { merge } from 'webpack-merge'

import { dependencies as externals } from '../../release/app/package.json'
import checkNodeEnv from '../../scripts/check-node-env'
import webpackPaths from './webpack.paths'

if (process.env.NODE_ENV === 'production') {
  checkNodeEnv('development')
}

const srcPath = join(webpackPaths.rootPath, 'src')
const srcMainPath = join(srcPath, 'main')

const configuration: webpack.Configuration = {
  devtool: 'inline-source-map',

  mode: 'development',

  target: 'electron-main',

  externals: [...Object.keys(externals || {}), 'terser-webpack-plugin'],

  stats: 'errors-only',

  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            compilerOptions: {
              module: 'esnext',
            },
          },
        },
      },
    ],
  },

  entry: {
    main: join(srcMainPath, 'main.ts'),
    preload: join(srcMainPath, 'modules/preload/preload.ts'),
  },

  output: {
    path: webpackPaths.dllPath,
    filename: '[name].js',
    library: {
      type: 'umd',
    },
  },

  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx'],
    modules: [srcPath, 'node_modules'],
    alias: {
      '@root/utils': join(srcPath, 'frontend', 'utils'),
      '@root': srcPath,
    },
  },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development',
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
      analyzerPort: 8888,
    }),
    new webpack.DefinePlugin({
      'process.type': '"browser"',
    }),
  ],

  node: {
    __dirname: false,
    __filename: false,
  },
}

export default configuration
