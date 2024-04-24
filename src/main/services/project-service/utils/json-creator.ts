import { writeFile } from 'fs'
import { join } from 'path'

type ICreateJSONFileProps = {
  path: string
  data: string
  fileName: string
}

const CreateJSONFile = (args: ICreateJSONFileProps) => {
  const { path, fileName, data } = args
  const normalizedPath = join(path, `${fileName}.json`)
  writeFile(normalizedPath, data, (error) => {
    if (error) throw error
  })
  return { ok: true }
}

export { CreateJSONFile }
