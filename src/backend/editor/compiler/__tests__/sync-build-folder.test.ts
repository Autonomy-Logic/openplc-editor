import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { syncBuildFolder } from '../editor-compiler-platform-port'

const PAST = new Date('2020-01-01T00:00:00Z')

function put(root: string, relPath: string, content: string): void {
  const abs = join(root, relPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  utimesSync(abs, PAST, PAST)
}

function mtime(root: string, relPath: string): number {
  return statSync(join(root, relPath)).mtimeMs
}

describe('syncBuildFolder', () => {
  let root: string
  const staticFiles = {
    'examples/Baremetal/hal_conf_extra.h': '#define HAL_X 1\n',
    'src/iec_types.hpp': '// runtime header\n',
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sync-build-folder-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('leaves unchanged static files untouched and rewrites generated ones', async () => {
    for (const [path, content] of Object.entries(staticFiles)) put(root, path, content)
    put(root, 'src/pou_MAIN.cpp', 'int a;\n')

    await syncBuildFolder(root, { ...staticFiles, 'src/pou_MAIN.cpp': 'int a;\n' }, staticFiles)

    expect(mtime(root, 'examples/Baremetal/hal_conf_extra.h')).toBe(PAST.getTime())
    expect(mtime(root, 'src/iec_types.hpp')).toBe(PAST.getTime())
    expect(mtime(root, 'src/pou_MAIN.cpp')).toBeGreaterThan(PAST.getTime())
  })

  it('rewrites a static file whose content changed', async () => {
    put(root, 'src/iec_types.hpp', '// old runtime header\n')

    await syncBuildFolder(root, staticFiles, staticFiles)

    expect(readFileSync(join(root, 'src/iec_types.hpp'), 'utf-8')).toBe(staticFiles['src/iec_types.hpp'])
    expect(mtime(root, 'src/iec_types.hpp')).toBeGreaterThan(PAST.getTime())
  })

  it('removes files no longer produced and keeps the arduino-cli export folder', async () => {
    put(root, 'src/pou_DELETED.cpp', 'int gone;\n')
    put(root, 'examples/Baremetal/build/arduino.avr.mega/Baremetal.ino.hex', ':00000001FF\n')

    await syncBuildFolder(root, staticFiles, staticFiles)

    expect(existsSync(join(root, 'src/pou_DELETED.cpp'))).toBe(false)
    expect(existsSync(join(root, 'examples/Baremetal/build/arduino.avr.mega/Baremetal.ino.hex'))).toBe(true)
  })

  it('writes every file into an empty or missing folder', async () => {
    const target = join(root, 'build', 'Board')

    await syncBuildFolder(target, { ...staticFiles, 'src/defines.h': '#define X\n' }, staticFiles)

    expect(readFileSync(join(target, 'src/defines.h'), 'utf-8')).toBe('#define X\n')
    expect(readFileSync(join(target, 'src/iec_types.hpp'), 'utf-8')).toBe(staticFiles['src/iec_types.hpp'])
  })
})
