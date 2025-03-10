import { execSync } from 'child_process'

class HardwareService {
  constructor() {}

  listSerialPorts() {
    try {
      let ports: string[] = []
      if (process.platform === 'win32') {
        const stdout = execSync('wmic path Win32_SerialPort get DeviceID,Name,Description', { encoding: 'utf8' })
        ports = stdout
          .split('\n')
          .filter((line) => line.trim() !== '' && !line.includes('DeviceID'))
          .map((line) => line.trim())
      } else if (process.platform === 'linux' || process.platform === 'darwin') {
        const cmd =
          process.platform === 'linux'
            ? 'ls /dev/ttyS* /dev/ttyUSB* /dev/ttyACM* 2>/dev/null'
            : 'ls /dev/tty.* 2>/dev/null'
        const stdout = execSync(cmd, { encoding: 'utf8' })
        ports = stdout.split('\n').filter((line) => line.trim() !== '')
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
