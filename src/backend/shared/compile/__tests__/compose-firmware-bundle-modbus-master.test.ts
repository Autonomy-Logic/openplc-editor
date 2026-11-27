import { composeFirmwareBundle } from '../steps/compose-firmware-bundle'

const STUB = '#define MB_MASTER_ENABLED 0\n'
const GENERATED = '#include "modbus_master_types.h"\n#define MB_MASTER_ENABLED 1\n'

const baseInput = {
  strucppFiles: {},
  cBlocks: { header: '// Empty file\n', code: null as string | null },
  definesH: '#define PROGRAM_MD5 ""\n',
  programMd5H: '#pragma once\n#define PROGRAM_MD5 ""\n',
  firmwareSkeleton: { 'src/modbus_master_config.h': STUB },
}

describe('composeFirmwareBundle: modbus_master_config.h', () => {
  it('writes the generated header over the skeleton stub when given', () => {
    const out = composeFirmwareBundle({ ...baseInput, modbusMasterConfigH: GENERATED })

    expect(out['src/modbus_master_config.h']).toBe(GENERATED)
  })

  it('keeps the skeleton stub when no header is given', () => {
    const out = composeFirmwareBundle(baseInput)

    expect(out['src/modbus_master_config.h']).toBe(STUB)
  })

  it('writes the header even when the skeleton has no stub', () => {
    const out = composeFirmwareBundle({ ...baseInput, firmwareSkeleton: {}, modbusMasterConfigH: GENERATED })

    expect(out['src/modbus_master_config.h']).toBe(GENERATED)
  })

  it('creates no header when neither is there', () => {
    const out = composeFirmwareBundle({ ...baseInput, firmwareSkeleton: {} })

    expect(Object.keys(out).filter((path) => path.includes('modbus_master_config'))).toEqual([])
  })

  it('leaves defines.h as given', () => {
    const out = composeFirmwareBundle({ ...baseInput, modbusMasterConfigH: GENERATED })

    expect(out['src/defines.h']).toBe('#define PROGRAM_MD5 ""\n')
  })
})
