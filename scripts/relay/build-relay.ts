/**
 * Bundles the vendor-document relay into a standalone `relay.js` for a vendor package's configurator folder.
 *
 *   npm run build:relay                  writes release/relay/relay.js
 *   npm run build:relay -- --out <dir>   writes <dir>/relay.js
 */
import { resolve } from 'node:path'

import webpack from 'webpack'

const REPO = resolve(__dirname, '..', '..')

function outDir(argv: string[]): string {
  const index = argv.indexOf('--out')
  if (index === -1) return resolve(REPO, 'release', 'relay')
  const value = argv[index + 1]
  if (!value) throw new Error('--out needs a directory')
  return resolve(value)
}

export function buildRelay(out: string): Promise<string> {
  const compiler = webpack({
    mode: 'production',
    devtool: false,
    target: 'web',
    context: __dirname,
    entry: { relay: './relay-entry.ts' },
    output: { path: out, filename: '[name].js' },
    resolve: { extensions: ['.ts', '.js'] },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'ts-loader',
          options: { transpileOnly: true, configFile: resolve(REPO, 'tsconfig.json') },
        },
      ],
    },
  })
  return new Promise((done, fail) => {
    compiler.run((error, stats) => {
      compiler.close(() => undefined)
      if (error) return fail(error)
      if (stats?.hasErrors()) return fail(new Error(stats.toString({ all: false, errors: true })))
      done(resolve(out, 'relay.js'))
    })
  })
}

if (require.main === module) {
  buildRelay(outDir(process.argv.slice(2))).then(
    (file) => console.log(`Wrote ${file}`),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}
