import { mkdirSync, writeFile } from 'fs'
import { join } from 'path'

/**
 *
 * Function to create a JSON file.
 *
 * @param path A string containing the path to create the file.
 * @param data The data to write.
 * @param fileName The name of the file to create.
 * @returns A boolean value indicating whether the file was created successfully or not.
 */
const CreateJSONFile = (path: string, data: string | NodeJS.ArrayBufferView, fileName: string) => {
  const normalizedPath = join(path, `${fileName}.json`)
  const dir = path
  if (dir) {
    mkdirSync(dir, { recursive: true })
  }
  writeFile(normalizedPath, data, (error) => {
    if (error) throw error
  })
  return { ok: true }
}

export { CreateJSONFile }
