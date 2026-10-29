import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EsiProjectFiles } from '../esi-project-files'

describe('EsiProjectFiles', () => {
  let project: string
  const files = new EsiProjectFiles()

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'esi-files-'))
  })
  afterEach(() => rmSync(project, { recursive: true, force: true }))

  it('reads, writes, lists and removes files in devices/esi', async () => {
    expect(await files.list(project)).toEqual([])
    expect(await files.read(project, 'repository.json')).toBeNull()

    await files.write(project, 'repository.json', '{"version":3}')
    await files.write(join(project, 'project.json'), 'a.xml', '<a/>')

    expect(readFileSync(join(project, 'devices', 'esi', 'repository.json'), 'utf-8')).toBe('{"version":3}')
    expect(await files.read(project, 'a.xml')).toBe('<a/>')
    expect((await files.list(project)).sort()).toEqual(['a.xml', 'repository.json'])

    await files.remove(project, 'a.xml')
    await files.remove(project, 'a.xml')
    expect(existsSync(join(project, 'devices', 'esi', 'a.xml'))).toBe(false)
  })

  it.each(['../project.json', 'sub/a.xml', '', '.', '..'])('refuses the name %p', async (name) => {
    await expect(files.read(project, name)).rejects.toThrow('Invalid ESI file name')
    await expect(files.write(project, name, 'x')).rejects.toThrow('Invalid ESI file name')
    await expect(files.remove(project, name)).rejects.toThrow('Invalid ESI file name')
  })
})
