import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DeviceSlice } from './types'

const createDeviceSlice: StateCreator<DeviceSlice, [], [], DeviceSlice> = (setState) => ({
  device: {
    availableBoards: [],
    availableCommunicationPorts: [],
    configuration: {
      deviceBoard: 'OpenPLC Runtime { default }',
      communicationPort: '',
      communicationConfiguration: {
        modbusRTU: {
          rtuInterface: [],
          rtuBaudrate: [],
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
    setDeviceBoard: (deviceBoard): void => {
      setState(
        produce(({ device }: DeviceSlice) => {
          device.configuration.deviceBoard = deviceBoard
        }),
      )
    },
    setCommunicationPort: (communicationPort): void => {
      setState(
        produce(({ device }: DeviceSlice) => {
          device.configuration.communicationPort = communicationPort
        }),
      )
    },
    setRTUSettings: (rtuSettings): void => {
      setState(
        produce(({ device }: DeviceSlice) => {
          for (const prop in rtuSettings) {
            device.configuration.communicationConfiguration.modbusRTU[prop] = rtuSettings[prop]
          }
        }),
      )
    },
  },
})

export { createDeviceSlice }
