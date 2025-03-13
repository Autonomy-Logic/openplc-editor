/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { spawn } from 'child_process'
import type { MessagePortMain } from 'electron'
import { join } from 'path'
class HardwareService {
  constructor() {}

  listSerialPorts(_mainProcessPort: MessagePortMain) {
    const isDevelopment = process.env.NODE_ENV === 'development'

    const scriptDirectory = join(
      isDevelopment ? process.cwd() : process.resourcesPath,
      isDevelopment ? 'resources' : '',
      'serial-communication',
    )

    let serialCommunicationBinary: string

    // Construct the path to the serial binary
    switch (process.platform) {
      case 'win32':
        serialCommunicationBinary = join(scriptDirectory, 'Windows', 'serial-communication.exe')
        break
      case 'darwin':
        serialCommunicationBinary = join(scriptDirectory, 'MacOS', 'serial-communication')
        break
      case 'linux':
        serialCommunicationBinary = join(scriptDirectory, 'Linux', 'serial-communication')
        break
      default:
        throw new Error(`Unsupported platform: ${process.platform}`)
    }
    // Spawn the Python process
    const serialCommunication = spawn('python3', [serialCommunicationBinary, 'list_ports'])

    serialCommunication.stdout.on('data', (data) => {
      const response = JSON.parse(data.toString())
      console.log('Python Process:', response)
    })
    // Handle errors from the Python process
    serialCommunication.stderr.on('data', (data) => {
      console.error('Python Process Error:', data.toString())
    })

    // Handle Python process exit
    serialCommunication.on('close', (code) => {
      console.log(`Python process exited with code ${code}`)
    })
  }
}

export { HardwareService }
