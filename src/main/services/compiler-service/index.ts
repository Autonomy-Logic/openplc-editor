import { exec } from 'child_process'
import { join } from 'path'

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

  /**
   * This is a mock implementation to be used as a presentation.
   * !! Do not use this on production !!
   */
  compileSTProgram: (pathToXMLFile: string) => {
    // Construct the path for the current working directory to be able to access the compiler
    const workingDirectory = process.cwd()

    // Construct the path for the st compiler script
    const stCompilerPath = join(workingDirectory, 'assets', 'python', 'st-compiler', 'xml2st.py')

    // Execute the st compiler script with the path to the xml file.
    // TODO: This only works on development environment. Need to be added the path for the production environment
    exec(`python3 ${stCompilerPath} '${pathToXMLFile}'`, (error, stdout, stderr) => {
      if (error) {
        console.error(`error: ${error.message}`)
        return
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`)
        return
      }
      console.log(`stdout: ${stdout}`)
    })
  },
}

export { CompilerService }
