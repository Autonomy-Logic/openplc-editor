import { cloudBuildDeviceFiles } from '../cloud-build-device-files'

const deviceDefinitions = {
  configuration: { deviceBoard: 'ESP32-DOIT DEVKIT V1', communicationPort: '/dev/cu.usbserial-0001' },
  pinMapping: {
    pinsByBoard: {
      'ESP32-DOIT DEVKIT V1': [
        { pin: '05', pinType: 'digitalInput', address: '%IX0.0', alias: 'switch' },
        { pin: '12', pinType: 'digitalOutput', address: '%QX0.0', alias: 'red' },
      ],
    },
  },
}

describe('cloudBuildDeviceFiles', () => {
  it('sends nothing for a local project, so its build keeps reading the saved files', () => {
    expect(cloudBuildDeviceFiles('/Users/someone/plc projects/semaphore', deviceDefinitions)).toBeUndefined()
    expect(cloudBuildDeviceFiles('C:\\projects\\semaphore', deviceDefinitions)).toBeUndefined()
  })

  it('serializes the device files of an Edge project the way a save writes them', () => {
    expect(cloudBuildDeviceFiles('cmufky1xt03of06oe9747hv68', deviceDefinitions)).toEqual({
      configuration: JSON.stringify(deviceDefinitions.configuration, null, 2),
      pinMapping: JSON.stringify(deviceDefinitions.pinMapping.pinsByBoard, null, 2),
    })
  })
})
