import { SerialPort } from 'serialport'

class HardwareService {
  constructor() {}

  async listSerialPorts() {
    try {
      const ports = await SerialPort.list()
      return ports
    } catch (error) {
      console.error('Error listing serial ports', error)
      return []
    }
  }
}

export { HardwareService }
