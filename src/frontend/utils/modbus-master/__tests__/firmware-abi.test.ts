import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIRMWARE_ROOTS = [
  join(__dirname, '..', '..', '..', '..', '..', 'resources', 'sources'),
  join(__dirname, '..', '..', '..', '..', 'assets', 'firmware'),
]

const FIRMWARE_ROOT = FIRMWARE_ROOTS.find((candidate) => existsSync(join(candidate, 'arduino', 's7comm_config.h')))

if (FIRMWARE_ROOT === undefined) {
  throw new Error(`Firmware sources not found. Looked in:\n${FIRMWARE_ROOTS.join('\n')}`)
}

const readArduino = (name: string): string => readFileSync(join(FIRMWARE_ROOT, 'arduino', name), 'utf-8')

const stripComments = (source: string): string =>
  source
    .replace(/\\\r?\n/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, '')

const defineOf = (code: string, name: string): string | undefined =>
  new RegExp(`^[ \\t]*#[ \\t]*define[ \\t]+${name}[ \\t]+(\\S+)`, 'm').exec(code)?.[1]

const COUNTS = [
  'MB_MASTER_ENDPOINT_COUNT',
  'MB_MASTER_BUS_COUNT',
  'MB_MASTER_DEVICE_COUNT',
  'MB_MASTER_GROUP_COUNT',
  'MB_MASTER_POINT_COUNT',
]

const TABLES = ['MB_MASTER_ENDPOINTS', 'MB_MASTER_BUSES', 'MB_MASTER_DEVICES', 'MB_MASTER_GROUPS', 'MB_MASTER_POINTS']

describe('modbus_master_config.h, the skeleton stub', () => {
  const stub = () => stripComments(readArduino('modbus_master_config.h'))

  it('leaves the master off', () => {
    expect(defineOf(stub(), 'MB_MASTER_ENABLED')).toBe('0')
    expect(defineOf(stub(), 'MB_MASTER_TCP_ENABLED')).toBe('0')
    expect(defineOf(stub(), 'MB_MASTER_RTU_ENABLED')).toBe('0')
  })

  it.each(COUNTS)('defines %s as 0', (count) => {
    expect(defineOf(stub(), count)).toBe('0')
  })

  it('declares no table', () => {
    for (const table of TABLES) {
      expect(stub()).not.toMatch(new RegExp(`\\b${table}\\s*\\[`))
    }
  })

  it('guards against a second inclusion', () => {
    expect(stub()).toMatch(/^[ \t]*#[ \t]*ifndef[ \t]+(\w+)[\s\S]*^[ \t]*#[ \t]*define[ \t]+\1\b[\s\S]*#[ \t]*endif/m)
  })
})

describe('modbus_master_types.h, the record types of the generated header', () => {
  const types = () => stripComments(readArduino('modbus_master_types.h'))

  it.each(['mb_master_endpoint_t', 'mb_master_bus_t', 'mb_master_device_t', 'mb_master_group_t', 'mb_master_point_t'])(
    'declares %s',
    (type) => {
      expect(types()).toMatch(new RegExp(`\\b${type}\\b`))
    },
  )

  it.each([
    'MB_MASTER_TCP',
    'MB_MASTER_RTU',
    'MB_MASTER_NO_PIN',
    'MB_PARITY_N',
    'MB_PARITY_E',
    'MB_PARITY_O',
    'MB_ERR_KEEP',
    'MB_ERR_ZERO',
    'MB_IMG_IX',
    'MB_IMG_IW',
    'MB_IMG_QX',
    'MB_IMG_QW',
  ])('declares %s', (identifier) => {
    expect(types()).toMatch(new RegExp(`\\b${identifier}\\b`))
  })
})
