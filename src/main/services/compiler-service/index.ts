import {spawn} from 'child_process'
import type {MessagePortMain} from 'electron'
import {join} from 'path'

import {CreateXMLFile} from '../../utils/xml-manager'

export type CompilerResponse = {
    error?: boolean
    message: {
        type: 'error' | 'warning' | 'info'
        content: string | Buffer
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
     * TODO:
     * 1 - We need to retrieve the Python script output and split it into multiple messages chunks to be sent to the renderer process.
     * 2 - We need to setup a communication channel between the renderer process and the main process, probably using MessagePort. Once ipc communication have limited functionality, we need to replace this mock implementation.
     * 3 - Refactor the function to open the communication channel and send the messages, and close it when the flow ends.
     */

    /**
     * This is a mock implementation to be used as a presentation.
     * !! Do not use this on production !!
     */
    compileSTProgram: (pathToProjectFile: string, mainProcessPort: MessagePortMain): void => {
        // Get the current environment and check if it's development
        const isDevelopment = process.env.NODE_ENV === 'development'

        // Check if the current platform is Windows to execute the correct command based on the current operating system
        const isWindows = process.platform === 'win32'

        // Construct the path for the current working directory to be able to access the compiler
        const workingDirectory = process.cwd()

        // Construct the path for the st compiler script based on the current environment
        const stCompilerPath = isDevelopment ? join(workingDirectory, 'assets', 'python', 'st-compiler', 'xml2st.py') : ''

        // Remove the project.json file from the path to the xml file.
        // This is necessary because on windows the path is handled differently from unix systems
        const draftPath = pathToProjectFile.replace('project.json', '')

        // Construct the path to the xml file
        const pathToXMLFile = join(draftPath, 'plc.xml')

        // Execute the st compiler script with the path to the xml file.
        // TODO: This only works on development environment. Need to be added the path for the production environment
        const execCompilerScript = spawn(isWindows ? 'py' : 'python3', [stCompilerPath, pathToXMLFile])

        /**
         * The data object is a buffer with the content of the script output.
         * Uses ASCII code to convert the buffer to a string.
         * End of lines are separated by \r and \n characters. The ASCII code for \r is 13 and \n is 10.
         */
        execCompilerScript.stdout.on('data', (data: Buffer) => {
            // const stream = []
            mainProcessPort.postMessage({type: 'default', data: data})
            // data.forEach((asciiCode, index) => {
            //     console.log('Here ->', asciiCode, index)
            // })
            // console.log(data.toString())
            // Using this method we can iterate over the buffer and visualize the content as a [index, value] pair value.
            // for (const pair of data.entries()) {
            //   console.log(pair)
            // }
            // Using this method we can iterate over the buffer and visualize the content as an ASCII character.
            // for (const bufferValue of data.values()) {
            //     // Here we look for the end of line characters.
            //     if (bufferValue === 13 || bufferValue === 10) {
            //     }
            // }
        })

        execCompilerScript.stderr.on('data', (data: Buffer) => {
            mainProcessPort.postMessage({type: 'error', data: data})
            // console.error(`stderr: ${data}`)
            // data.forEach((asciiCode, index) => {
            //     console.log('ASCII code ->', asciiCode, index)
            // })
        })

        execCompilerScript.on('close', (code) => {
            mainProcessPort.postMessage({type: 'info', code})
            mainProcessPort.close()
        })
    },
}

export {CompilerService}
