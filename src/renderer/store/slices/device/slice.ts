import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DeviceSlice } from './types'

const createDeviceSlice: StateCreator<DeviceSlice, [], [], DeviceSlice> = (setState) => ({
  device: {
    availableBoards: [],
    availableCommunicationPorts: [],
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
    setAvailableOptions: ({ availableBoards, availableCommunicationPorts }): void => {
      setState(
        produce(({ device }: DeviceSlice) => {
          device.availableBoards = availableBoards
          device.availableCommunicationPorts = availableCommunicationPorts
        }),
      )
    },
    addPin: (pinProp): void => {
      setState(
        produce(({ device }: DeviceSlice) => {
          console.log('Pin parameter:', pinProp)
          console.log('Device state:', device)
        }),
      )
    },
    setDeviceConfiguration: (deviceBoard, communicationPort): void => {
      setState(
        produce(({ device }: DeviceSlice) => {
          device.configuration.deviceBoard = deviceBoard
          device.configuration.communicationPort = communicationPort
        }),
      )
    },
  },
})

export { createDeviceSlice }
