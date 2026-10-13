import { randomBytes } from 'crypto'
import { chmod, mkdir, open, rename, rm, stat } from 'fs/promises'
import { join } from 'path'

export interface OwnerOnlyTextFile {
  /** Null when the file does not exist; throws when it exists but cannot be read or is too large. */
  read(): Promise<string | null>
  /** Replaces the whole file atomically: 0600 file in a 0700 directory. */
  write(content: string): Promise<void>
}

export const createOwnerOnlyTextFile = (
  directory: string,
  fileName: string,
  maxBytes: number,
  label: string,
): OwnerOnlyTextFile => {
  const file = join(directory, fileName)
  return {
    read: async () => {
      let size: number
      try {
        size = (await stat(file)).size
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null
        throw error
      }
      if (size > maxBytes) throw new Error(`${label} file too large`)
      const handle = await open(file, 'r')
      try {
        return await handle.readFile({ encoding: 'utf-8' })
      } finally {
        await handle.close()
      }
    },
    write: async (content) => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700)
      const temporary = join(directory, `.${fileName}.${randomBytes(8).toString('hex')}.tmp`)
      try {
        const handle = await open(temporary, 'wx', 0o600)
        try {
          await handle.writeFile(content, { encoding: 'utf-8' })
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temporary, file)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
    },
  }
}
