import { writeFile } from 'fs'
import { join } from 'path'

/**
 * Create a xml file with the given params.
 * @param path - the path where the file must be created
 * @param dataToWrite - the data to write in the file
 * @param fileName - the file display name
 */
const CreateXMLFile = (path: string, dataToWrite: string, fileName: string) => {
  const normalizedPath = join(path, `${fileName}.xml`)
  writeFile(normalizedPath, dataToWrite, (error) => {
    if (error) return { success: false, error }
  })
  return { success: true, message: 'Xml file created successfully' }
}

export { CreateXMLFile }
