import type { DeviceSetup } from '@root/middleware/shared/vendor-document/protocol'

/** A module of the configurator's device setup, in the shape stored under `vendorScreenData['device-setup']`. */
export interface DeviceSetupModule {
  guid: string
  instanceName: string
  typeId: string
  /** 1-based position on the system bus. */
  slot: number
}

export interface DeviceSetupRecord {
  modules: DeviceSetupModule[]
}

export function toDeviceSetupRecord(setup: DeviceSetup): DeviceSetupRecord {
  return {
    modules: setup.devices.map((device, index) => ({
      guid: device.guid,
      instanceName: device.name,
      typeId: device.typeId,
      slot: index + 1,
    })),
  }
}
