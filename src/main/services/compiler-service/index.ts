import { exec } from 'child_process'
import { join } from 'path'

import { CreateXMLFile } from '../../utils/xml-manager'

export type CompilerResponse = {
  error?: boolean
  message: {
    type: 'error' | 'warning' | 'info'
    content: string
  }
}

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
  compileSTProgram: (pathToXMLFile: string): CompilerResponse => {
    const responseObject: CompilerResponse = {
      error: false,
      message: {
        type: 'info',
        content: 'Compilation started',
      },
    }

    const isDevelopment = process.env.NODE_ENV === 'development'

    // Construct the path for the current working directory to be able to access the compiler
    const workingDirectory = process.cwd()

    // Construct the path for the st compiler script based on the current environment
    const stCompilerPath = isDevelopment ? join(workingDirectory, 'assets', 'python', 'st-compiler', 'xml2st.py') : ''

    // Execute the st compiler script with the path to the xml file.
    // TODO: This only works on development environment. Need to be added the path for the production environment
    exec(`python3 ${stCompilerPath} '${pathToXMLFile}'`, (error, stdout, stderr) => {
      if (error) {
        responseObject.error = true
        responseObject.message = { type: 'error', content: error.message }
        return
      }
      if (stderr) {
        responseObject.error = true
        responseObject.message = { type: 'error', content: stderr }
        return
      }
      responseObject.message = {
        type: 'info',
        content: stdout,
      }
    })

    return responseObject
  },
}

export { CompilerService }
