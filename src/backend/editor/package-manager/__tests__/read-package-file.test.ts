import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { InstalledPackage } from '../../../../middleware/shared/ports/types'
import { readPackageFile } from '../read-package-file'

describe('readPackageFile', () => {
  let root: string
  let pkg: InstalledPackage

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'read-package-file-'))
    const packagePath = join(root, 'packages', 'com.openplc.arduino')
    mkdirSync(join(packagePath, 'screens'), { recursive: true })
    mkdirSync(join(root, 'packages', 'common'), { recursive: true })
    writeFileSync(join(packagePath, 'screens', 'serial.json'), '{"sections":[]}', 'utf-8')
    writeFileSync(join(root, 'packages', 'common', 'serial.json'), '{"outside":true}', 'utf-8')
    pkg = {
      packageId: 'com.openplc.arduino',
      version: '1.0.0',
      installedAt: '2026-11-16T00:00:00.000Z',
      path: packagePath,
      devices: ['arduino-mega'],
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads the text of a file inside the package', () => {
    expect(readPackageFile(pkg, 'screens/serial.json')).toBe('{"sections":[]}')
  })

  it('refuses a path that leaves the package, even when the file there exists', () => {
    expect(() => readPackageFile(pkg, '../common/serial.json')).toThrow(/outside/)
  })

  it('throws when the file does not exist in the package', () => {
    expect(() => readPackageFile(pkg, 'screens/network.json')).toThrow()
  })
})
