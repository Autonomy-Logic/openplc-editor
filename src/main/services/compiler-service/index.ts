import { CreateXMLFile } from '../../utils/xml-manager'

const CompilerService = {
  writeXMLFile: (path: string, data: string, fileName: string) => {
    const ok = CreateXMLFile({
      path,
      data,
      fileName,
    })
    return ok
  },
}

export { CompilerService }
