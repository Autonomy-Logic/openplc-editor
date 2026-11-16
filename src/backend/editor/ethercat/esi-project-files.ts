import { promises } from 'fs'
import { basename, dirname, join } from 'path'

import { resolveProjectDataDir } from '../project/cloud-project-data'

/**
 * File I/O in a project's `devices/esi` folder: the desktop's `EsiFileStore`
 * mechanism. The shared ESI store (`backend/shared/ethercat/esi-file-store.ts`)
 * decides what the files contain.
 */
class EsiProjectFiles {
  private dir(projectPath: string): string {
    const basePath = basename(projectPath) === 'project.json' ? dirname(projectPath) : projectPath
    // A cloud project is an Edge id, not a directory; its ESI files live in its local data folder.
    return join(resolveProjectDataDir(basePath), 'devices', 'esi')
  }

  /** Only a plain name inside the folder is accepted, never a path. */
  private file(projectPath: string, name: string): string {
    if (name !== basename(name) || name === '' || name === '.' || name === '..') {
      throw new Error(`Invalid ESI file name: ${name}`)
    }
    return join(this.dir(projectPath), name)
  }

  async read(projectPath: string, name: string): Promise<string | null> {
    try {
      return await promises.readFile(this.file(projectPath, name), 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async write(projectPath: string, name: string, text: string): Promise<void> {
    const path = this.file(projectPath, name)
    await promises.mkdir(dirname(path), { recursive: true })
    await promises.writeFile(`${path}.tmp`, text, 'utf-8')
    await promises.rename(`${path}.tmp`, path)
  }

  async remove(projectPath: string, name: string): Promise<void> {
    await promises.rm(this.file(projectPath, name), { force: true })
  }

  async list(projectPath: string): Promise<string[]> {
    try {
      return await promises.readdir(this.dir(projectPath))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
}

export { EsiProjectFiles }
