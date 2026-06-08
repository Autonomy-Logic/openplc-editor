import { writeFileSync } from 'fs'
import { join } from 'path'

/**
 *
 * Function to create a JSON file.  Synchronous on purpose: callers
 * (project creation, project-file writers) chain multiple writes
 * back-to-back and immediately return the result to the renderer
 * — the renderer then opens the project, which reads these files.
 * The previous async-fire-and-forget form returned `{ok: true}`
 * before the write actually flushed, leaving a 0-byte file on disk
 * if the process did anything subsequent that interrupted libuv's
 * I/O queue.  The user's library projects ended up with empty
 * `devices/configuration.json` / `pin-mapping.json` exactly this
 * way, which broke any later read (`Unexpected end of JSON input`).
 *
 * @param path A string containing the path to create the file.
 * @param data The data to write.
 * @param fileName The name of the file to create.
 * @returns `{ ok: true }` after the write has been flushed.
 */
const CreateJSONFile = (path: string, data: string | NodeJS.ArrayBufferView, fileName: string) => {
  const normalizedPath = join(path, `${fileName}.json`)
  writeFileSync(normalizedPath, data)
  return { ok: true }
}

export { CreateJSONFile }
