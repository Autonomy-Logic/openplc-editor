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
          rtuInterface: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
          rtuBaudrate: ['115200', '9600', '19200', '38400', '57600', '115200'],
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
          ;(Object.entries(rtuSettings) as [keyof typeof rtuSettings, string | string[]][]).forEach(([key, value]) => {
            const target = device.configuration.communicationConfiguration.modbusRTU
            if (key === 'rtuInterface' || key === 'rtuBaudrate') {
              target[key] = value as string[]
            } else {
              target[key] = value as string
            }
          })
        }),
      )
    },
  },
})

export { createDeviceSlice }
