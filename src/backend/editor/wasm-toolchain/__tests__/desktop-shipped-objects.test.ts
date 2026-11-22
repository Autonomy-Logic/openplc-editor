/** @jest-environment node */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDesktopShippedObjects, shippedObjectsDir } from '../desktop-shipped-objects'

const RECORD = `${'b'.repeat(64)}.obj`

describe('desktop shipped objects', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shipped-')))
  const dir = join(root, 'hmi-objects')
  const outside = join(root, 'project')
  mkdirSync(dir)
  mkdirSync(outside)
  writeFileSync(join(dir, 'index.json'), '{}')
  writeFileSync(join(outside, 'secret.obj'), 'not shipped')
  symlinkSync(join(outside, 'secret.obj'), join(dir, RECORD))
  const source = createDesktopShippedObjects(dir)

  it('reads only from the installation, or the repository build output in development', () => {
    expect(shippedObjectsDir({ isPackaged: true, resourcesPath: '/app/Resources', cwd: '/home/u/project' })).toBe(
      join('/app/Resources', 'hmi-objects'),
    )
    expect(shippedObjectsDir({ isPackaged: false, resourcesPath: '/x', cwd: '/repo' })).toBe(
      join('/repo', 'release', 'hmi-objects'),
    )
  })

  it('reads a file of its folder verbatim', async () => {
    expect(new TextDecoder().decode((await source.read('index.json')) ?? new Uint8Array())).toBe('{}')
  })

  it('refuses a link out of its folder, a path, and any name that is not a shipped file', async () => {
    expect(await source.read(RECORD)).toBeNull()
    expect(await source.read('../project/secret.obj')).toBeNull()
    expect(await source.read(join(outside, 'secret.obj'))).toBeNull()
    expect(await source.read(`${'c'.repeat(64)}.obj`)).toBeNull()
  })
})
