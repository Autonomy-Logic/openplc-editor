/**
 * Base webpack config used across other specific configs
 */
/* eslint-disable import/no-named-as-default */
/* eslint import/no-unresolved: [2, { ignore: ['\\.release/app/package.json$'] }] */

import TsconfigPathsPlugins from 'tsconfig-paths-webpack-plugin';
import webpack from 'webpack';

import { dependencies as externals } from '../../release/app/package.json';
import webpackPaths from './webpack.paths';

const configuration: webpack.Configuration = {
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
            // Remove this line to enable type checking in webpack builds
            transpileOnly: true,
            compilerOptions: {
              module: 'esnext',
            },
          },
        },
      },
    ],
  },

  output: {
    path: webpackPaths.srcPath,
    // https://github.com/webpack/webpack/issues/1114
    library: {
      type: 'commonjs2',
    },
  },

  /**
   * Determine the array of extensions that should be used to resolve modules.
   */
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx'],
    modules: [webpackPaths.srcPath, 'node_modules'],
    // There is no need to add aliases here, the paths in tsconfig get mirrored
    plugins: [new TsconfigPathsPlugins()],
    fallback: {
      path: require.resolve('path-browserify'),
      url: require.resolve('url/'),
    },
    alias: {
      '@': webpackPaths.srcPath,
      '@renderer': webpackPaths.srcRendererPath,
      '@main': webpackPaths.srcMainPath,
    },
  },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
    }),
  ],
};

export default configuration;
