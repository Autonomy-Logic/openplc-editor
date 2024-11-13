import { writeFile } from 'fs'
import { join } from 'path'

import { createDirectoryIfNotExists } from '../services/utils/create-directory-if-not-exists'

type ICreateXMLFileProps = {
  path: string
  data: string
  fileName: string
}

const CreateXMLFile = (args: ICreateXMLFileProps) => {
  const { path, fileName, data } = args
  createDirectoryIfNotExists(path)
    .then(() => {
      const normalizedPath = join(path, `${fileName}.xml`)
      writeFile(normalizedPath, data, (error) => {
        if (error) throw error
      })
      return { ok: true }
    })
    .catch(() => {
      return { ok: false }
    })
}

export { CreateXMLFile }
