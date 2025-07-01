import { DeviceConfiguration } from '@root/types/PLC/devices'

// Default configuration for deviceDefinitions.configuration
export const defaultDeviceConfiguration: DeviceConfiguration = {
  deviceBoard: 'OpenPLC Runtime',
  communicationPort: '',
  communicationConfiguration: {
    modbusRTU: {
      rtuInterface: 'Serial',
      rtuBaudRate: '115200',
      rtuSlaveId: null,
      rtuRS485ENPin: null,
    },
    modbusTCP: {
      tcpInterface: 'Ethernet',
      // tcpMacAddress: '0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD',
      tcpMacAddress: 'DE:AD:BE:EF:DE:AD',
      tcpStaticHostConfiguration: {
        ipAddress: '',
        dns: '',
        gateway: '',
        subnet: '',
      },
    },
    communicationPreferences: {
      enabledRTU: false,
      enabledTCP: false,
      enabledDHCP: true,
    },
  },
}
