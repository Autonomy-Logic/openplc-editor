/**
 * Desktop mechanism of the HMI preview: reads the files it compiles in, verbatim. Which of them are sources, fonts or
 * units is decided by the shared preview port.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Every file under `dir`, recursively, as bytes keyed by its path relative to `dir` with `/` separators. */
export async function readFolderBytes(dir: string, prefix = ''): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(files, await readFolderBytes(path, `${prefix}${entry.name}/`))
    else if (entry.isFile()) files[`${prefix}${entry.name}`] = new Uint8Array(await readFile(path))
  }
  return files
}

/** The files directly in `dir` as UTF-8 text, keyed by file name. */
export async function readFolderText(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile()) files[entry.name] = await readFile(join(dir, entry.name), 'utf-8')
  }
  return files
}
