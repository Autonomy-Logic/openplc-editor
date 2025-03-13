/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { spawn } from 'child_process'
import { join } from 'path'
class HardwareService {
  constructor() {}

  listSerialPorts() {
    let availablePorts = 'No ports available'
    // Construct the path to the python script
    const scriptPath = join(process.cwd(), 'resources', 'serial-communication', 'main.py')
    // Spawn the Python process
    const serialCommunication = spawn('python3', [scriptPath])

    // Request the list of available ports
    const listPortsCommand = {
      action: 'list_ports',
    }
    serialCommunication.stdin.write(JSON.stringify(listPortsCommand) + '\n')

    serialCommunication.stdout.on('data', (data) => {
      const response = JSON.parse(data.toString())
      console.log('Python Process:', response)

      if (response.status === 'success' && response.ports) {
        availablePorts = response.ports
      }
    })
    // Handle errors from the Python process
    serialCommunication.stderr.on('data', (data) => {
      console.error('Python Process Error:', data.toString())
    })

    // Handle Python process exit
    serialCommunication.on('close', (code) => {
      console.log(`Python process exited with code ${code}`)
    })
    return availablePorts
  }
}

export { HardwareService }
