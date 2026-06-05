import { promises } from 'fs'

export const isEmptyDir = async (filePath: string) => {
  try {
    const directory = await promises.opendir(filePath)
    const entry = await directory.read()
    await directory.close()
    return entry === null
  } catch (_error) {
    return false
  }
}
