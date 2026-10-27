import type { VppModuleDefinition } from '../../../../middleware/shared/ports/types'
import { toVppModuleDefinition } from '../to-vpp-module-definition'

const io = { digitalInputs: 2, digitalOutputs: 0, analogInputs: 0, analogOutputs: 0 }

const ur20Module: VppModuleDefinition = {
  id: 'ur20-2di-p-ts',
  name: 'UR20-2DI-P-TS',
  typeId: '0f014700',
  processImage: { inputBytes: 60, outputBytes: 0 },
  io,
  addressMapping: {
    channels: [
      { name: 'input_image_1', type: 'digitalInput', dataType: 'USINT', addressPrefix: '%IB', wire: { byte: 0 } },
    ],
  },
}

function withRaw(field: string, value: unknown): VppModuleDefinition {
  const module: VppModuleDefinition = { id: 'm', name: 'M', io }
  Reflect.set(module, field, value)
  return module
}

describe('toVppModuleDefinition', () => {
  it('forwards typeId, processImage and the channel wire positions', () => {
    const out = toVppModuleDefinition(ur20Module, undefined)
    expect(out.typeId).toBe('0f014700')
    expect(out.processImage).toEqual({ inputBytes: 60, outputBytes: 0 })
    expect(out.addressMapping).toEqual(ur20Module.addressMapping)
  })

  it('keeps an all-digit typeId as the exact string', () => {
    expect(toVppModuleDefinition({ ...ur20Module, typeId: '01000000' }, undefined).typeId).toBe('01000000')
  })

  it('keeps the fields it forwarded before', () => {
    const module: VppModuleDefinition = {
      id: 'opta',
      name: 'Opta',
      hwId: '0x24A500E1',
      fixed: true,
      image: 'opta.png',
      description: 'Built-in I/O',
      specs: { voltage: '24V' },
      configScreen: 'screens/opta.json',
      io,
      parameters: [{ id: 'p', name: 'P', type: 'number' }],
      addressMapping: { channels: [] },
    }
    const definition = { sections: [] }
    expect(toVppModuleDefinition(module, definition)).toEqual({ ...module, configScreenDefinition: definition })
  })

  it('omits typeId and processImage when the manifest does not declare them', () => {
    const out = toVppModuleDefinition({ id: 'm', name: 'M', io }, undefined)
    expect('typeId' in out).toBe(false)
    expect('processImage' in out).toBe(false)
  })

  it.each([
    ['a number', 1000000],
    ['an empty string', ''],
  ])('leaves out a typeId that is %s', (_label, value) => {
    expect('typeId' in toVppModuleDefinition(withRaw('typeId', value), undefined)).toBe(false)
  })

  it.each([
    ['negative', { inputBytes: -1, outputBytes: 0 }],
    ['fractional', { inputBytes: 1.5, outputBytes: 0 }],
    ['missing outputBytes', { inputBytes: 2 }],
    ['a string count', { inputBytes: '2', outputBytes: 0 }],
    ['not an object', 4],
  ])('leaves out a processImage that is %s', (_label, value) => {
    expect('processImage' in toVppModuleDefinition(withRaw('processImage', value), undefined)).toBe(false)
  })
})
