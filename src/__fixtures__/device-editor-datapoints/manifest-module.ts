/** Builds the manifest module a package catalogue declares for a captured module, as the packages generator does. */

import type { VppModuleDefinition } from '@root/middleware/shared/ports/types'
import type { DataPoint, DeviceSetup } from '@root/middleware/shared/vendor-document/protocol'

const SIZE_BY_BITLENGTH: Readonly<Record<number, string>> = { 1: 'X', 8: 'B', 16: 'W', 32: 'D' }
const IEC_TYPE: Readonly<Record<string, string>> = {
  UInt8: 'USINT',
  UInt16: 'UINT',
  UInt32: 'UDINT',
  Int8: 'SINT',
  Int16: 'INT',
  Int32: 'DINT',
  REAL: 'REAL',
}

type ManifestChannel = {
  name: string
  type: string
  dataType: string
  addressPrefix: string
  wire: { byte: number; bit?: number }
}

export function manifestModuleFromCapture(
  capture: { deviceSetup: DeviceSetup; dataPoints: DataPoint[] },
  deviceIndex: number,
  module: { id: string; name: string },
): VppModuleDefinition {
  const device = capture.deviceSetup.devices[deviceIndex]
  const prefix = `${device.guid}_`
  const processImage = { inputBytes: 0, outputBytes: 0 }
  const channels: ManifestChannel[] = []

  for (const dataPoint of capture.dataPoints) {
    if (!dataPoint.id.startsWith(prefix)) continue
    const input = dataPoint.access === 'ro'
    const isBit = dataPoint.bitlength === 1
    const end = dataPoint.byteoffset + Math.ceil(dataPoint.bitlength / 8)
    if (input) processImage.inputBytes = Math.max(processImage.inputBytes, end)
    else processImage.outputBytes = Math.max(processImage.outputBytes, end)
    channels.push({
      name: dataPoint.name.slice(device.name.length + 1),
      type: `${isBit ? 'digital' : 'analog'}${input ? 'Input' : 'Output'}`,
      dataType: isBit ? 'BOOL' : (IEC_TYPE[dataPoint.datatype] ?? dataPoint.datatype),
      addressPrefix: `%${input ? 'I' : 'Q'}${SIZE_BY_BITLENGTH[dataPoint.bitlength]}`,
      wire: isBit ? { byte: dataPoint.byteoffset, bit: dataPoint.bitoffset } : { byte: dataPoint.byteoffset },
    })
  }

  const count = (type: string) => channels.filter((channel) => channel.type === type).length
  return {
    id: module.id,
    name: module.name,
    typeId: device.typeId,
    processImage,
    io: {
      digitalInputs: count('digitalInput'),
      digitalOutputs: count('digitalOutput'),
      analogInputs: count('analogInput'),
      analogOutputs: count('analogOutput'),
    },
    addressMapping: { channels },
  }
}
