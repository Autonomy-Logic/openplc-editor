import { exec } from 'child_process'
import { promisify } from 'util'

class HardwareService {
  constructor() {}

  async listSerialPorts() {
    const runListPortsCmd = promisify(exec)
    try {
      let ports: string[] = []
      if (process.platform === 'win32') {
        const { stderr, stdout } = await runListPortsCmd('mode | findstr /i "COM"')
        ports = stdout
          .split('\n')
          .filter((line) => line.trim() !== '' && !line.includes('DeviceID'))
          .map((line) => line.trim())

        console.error('Error object ->', stderr)
      } else if (process.platform === 'linux' || process.platform === 'darwin') {
        const cmd =
          process.platform === 'linux'
            ? 'ls /dev/ttyS* /dev/ttyUSB* /dev/ttyACM* 2>/dev/null'
            : 'ls /dev/tty.* 2>/dev/null'
        const { stderr, stdout } = await runListPortsCmd(cmd)
        ports = stdout.split('\n').filter((line) => line.trim() !== '')
        console.error('Error object ->', stderr)
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`)
      }
      return ports
    } catch (error) {
      console.error('Error listing serial ports: ', error)
      throw error
    }
  }
}

export { HardwareService }
