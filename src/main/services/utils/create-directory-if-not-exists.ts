import { access, constants, mkdir } from "fs/promises"

export const createDirectoryIfNotExists = async (path: string): Promise<void> => {
  try {
    await access(path, constants.F_OK)
    console.log(`Directory found at ${path}`)
  } catch {
    try {
      await mkdir(path, { recursive: true })
      console.log(`Directory created at ${path}`)
    } catch (err) {
      console.error(`Error creating directory at ${path}: ${err.message}`)
    }
  }
}
