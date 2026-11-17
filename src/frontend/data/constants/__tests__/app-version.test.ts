import { readFileSync } from 'fs'
import { join } from 'path'

import { APP_VERSION } from '../app-version'

/** Reads the `version` field of the repository root `package.json`. */
function rootPackageVersion(): unknown {
  const manifest: unknown = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))
  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest)) return undefined
  return manifest.version
}

describe('APP_VERSION', () => {
  it('equals the version of the root package.json', () => {
    expect(APP_VERSION).toBe(rootPackageVersion())
  })
})
