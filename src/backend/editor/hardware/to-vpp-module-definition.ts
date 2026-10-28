import type { VppModuleDefinition } from '../../../middleware/shared/ports/types'

type ProcessImage = NonNullable<VppModuleDefinition['processImage']>

function isByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function readTypeId(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function readProcessImage(value: unknown): ProcessImage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const inputBytes: unknown = Reflect.get(value, 'inputBytes')
  const outputBytes: unknown = Reflect.get(value, 'outputBytes')
  return isByteCount(inputBytes) && isByteCount(outputBytes) ? { inputBytes, outputBytes } : undefined
}

/** The manifest module fields the renderer receives; a malformed `typeId` or `processImage` is left out. */
export function toVppModuleDefinition(
  module: VppModuleDefinition,
  configScreenDefinition: unknown,
): VppModuleDefinition {
  const typeId = readTypeId(module.typeId)
  const processImage = readProcessImage(module.processImage)
  return {
    id: module.id,
    name: module.name,
    hwId: module.hwId,
    ...(typeId !== undefined ? { typeId } : {}),
    ...(processImage !== undefined ? { processImage } : {}),
    fixed: module.fixed,
    image: module.image,
    description: module.description,
    specs: module.specs,
    configScreen: module.configScreen,
    configScreenDefinition,
    io: module.io,
    parameters: module.parameters,
    addressMapping: module.addressMapping,
  }
}
