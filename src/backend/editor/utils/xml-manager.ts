import { writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Create an xml file with the given params.  Synchronous on
 * purpose, same reason `CreateJSONFile` is: every caller chains
 * the next step (running xml2st on the file) immediately after,
 * and the previous async-fire-and-forget form returned success
 * before libuv had actually flushed the bytes — a fast subsequent
 * spawn could read 0 bytes.  The compile pipeline never observed
 * this in practice because xml2st spawns slowly enough that the
 * write usually won the race, but the API contract has always
 * been wrong.
 *
 * @param path - the path where the file must be created
 * @param dataToWrite - the data to write in the file
 * @param fileName - the file display name
 */
const CreateXMLFile = (path: string, dataToWrite: string, fileName: string) => {
  const normalizedPath = join(path, `${fileName}.xml`)
  try {
    writeFileSync(normalizedPath, dataToWrite)
    return { success: true, message: 'Xml file created successfully' }
  } catch (error) {
    return { success: false, error }
  }
}

export { CreateXMLFile }
