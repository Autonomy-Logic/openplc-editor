import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DeviceSlice } from './types'

const createDeviceSlice: StateCreator<DeviceSlice, [], [], DeviceSlice> = (setState) => ({
  device: {
    configuration: {
      deviceBoard: '',
      communicationPort: '',
      communicationConfiguration: {
        modbusRTU: {
          rtuInterface: '',
          rtuBaudrate: '',
          rtuSlaveId: '',
          rtuRS485TXPin: '',
        },
        modbusTCP: {
          tcpInterface: 'wifi',
          tcpMacAddress: '',
          tcpWifiSSID: '',
          tcpWifiPassword: '',
        },
      },
    },
    pinMapping: [],
  },

  deviceActions: {
    addPin: (pinProp): void => {
      setState(
        produce(({ device }: DeviceSlice) => {
          console.log('Pin parameter:', pinProp)
          console.log('Device state:', device)
        }),
      )
    },
  },
})

export { createDeviceSlice }
