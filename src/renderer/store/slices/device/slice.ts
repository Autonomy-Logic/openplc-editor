import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DeviceSlice } from './types'

const createDeviceSlice: StateCreator<DeviceSlice, [], [], DeviceSlice> = (setState) => ({
  deviceAvailableOptions: {
    availableBoards: new Map(),
    availableCommunicationPorts: [],
    availableRTUInterfaces: [],
    availableRTUBaudrates: [],
    availableTCPInterfaces: ['ethernet', 'wifi'], // The available TCP interfaces is always ['ethernet', 'wifi'], so we can set it on the slice creation.
  },
  deviceDefinitions: {
    configuration: {
      deviceBoard: 'OpenPLC Runtime [ default ]',
      communicationPort: '',
      communicationConfiguration: {
        modbusRTU: {
          rtuInterface: 'Serial',
          rtuBaudrate: '115200',
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
        produce(({ deviceAvailableOptions }: DeviceSlice) => {
          if (availableBoards) {
            deviceAvailableOptions.availableBoards = availableBoards
          }
          if (availableCommunicationPorts) {
            deviceAvailableOptions.availableCommunicationPorts = availableCommunicationPorts
          }
        }),
      )
    },
    addPin: (pinProp): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          console.log('Pin parameter:', pinProp)
          console.log('Device state:', deviceDefinitions)
        }),
      )
    },
    setDeviceBoard: (deviceBoard): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          deviceDefinitions.configuration.deviceBoard = deviceBoard
        }),
      )
    },
    setCommunicationPort: (communicationPort): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          deviceDefinitions.configuration.communicationPort = communicationPort
        }),
      )
    },
    setRTUSettings: (rtuSettings): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          ;(Object.entries(rtuSettings) as [keyof typeof rtuSettings, string][]).forEach(([key, value]) => {
            deviceDefinitions.configuration.communicationConfiguration.modbusRTU[key] = value
          })
        }),
      )
    },
  },
})

export { createDeviceSlice }
