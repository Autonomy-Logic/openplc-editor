import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  BoardInfo,
  ModbusIOGroup,
  ModbusRemoteTcpConfig,
  PLCRemoteDevice,
} from '@root/middleware/shared/ports/types'
import { resolveModbusMasterProfile } from '@root/middleware/shared/utils/modbus-master-profile'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'

import { generateModbusMasterHeader } from '../generate-modbus-master-header'

const FIRMWARE_ROOTS = [
  join(__dirname, '..', '..', '..', '..', '..', 'resources', 'sources'),
  join(__dirname, '..', '..', '..', '..', 'assets', 'firmware'),
]

const ARDUINO_DIR = join(
  FIRMWARE_ROOTS.find((candidate) => existsSync(join(candidate, 'arduino', 's7comm_config.h'))) ?? FIRMWARE_ROOTS[0],
  'arduino',
)

const ARDUINO_STAND_IN = `#ifndef ARDUINO_STAND_IN_H
#define ARDUINO_STAND_IN_H
#include <stddef.h>
#include <stdint.h>
class HardwareSerial {
 public:
  void begin(unsigned long) {}
};
extern HardwareSerial Serial;
extern HardwareSerial Serial1;
extern HardwareSerial Serial2;
extern HardwareSerial Serial3;
#endif
`

const TRANSLATION_UNIT = `#include "Arduino.h"
#include "modbus_master_config.h"
#if MB_MASTER_ENDPOINT_COUNT > 0
static_assert(sizeof(MB_MASTER_ENDPOINTS) / sizeof(MB_MASTER_ENDPOINTS[0]) == MB_MASTER_ENDPOINT_COUNT, "endpoints");
#endif
#if MB_MASTER_BUS_COUNT > 0
static_assert(sizeof(MB_MASTER_BUSES) / sizeof(MB_MASTER_BUSES[0]) == MB_MASTER_BUS_COUNT, "buses");
#endif
#if MB_MASTER_DEVICE_COUNT > 0
static_assert(sizeof(MB_MASTER_DEVICES) / sizeof(MB_MASTER_DEVICES[0]) == MB_MASTER_DEVICE_COUNT, "devices");
#endif
#if MB_MASTER_GROUP_COUNT > 0
static_assert(sizeof(MB_MASTER_GROUPS) / sizeof(MB_MASTER_GROUPS[0]) == MB_MASTER_GROUP_COUNT, "groups");
#endif
#if MB_MASTER_POINT_COUNT > 0
static_assert(sizeof(MB_MASTER_POINTS) / sizeof(MB_MASTER_POINTS[0]) == MB_MASTER_POINT_COUNT, "points");
#endif
int main() { return MB_MASTER_ENABLED + MB_MASTER_TCP_ENABLED + MB_MASTER_RTU_ENABLED; }
`

const MEGA: BoardInfo = {
  compiler: 'arduino-cli',
  core: 'arduino:avr',
  preview: '',
  specs: {},
  serialPorts: ['Serial', 'Serial1', 'Serial2', 'Serial3'],
  defaultSerial: 'Serial',
  capabilities: { modbusTcpMaster: true, networkSockets: 4 },
}

const PROFILE = resolveModbusMasterProfile(MEGA, resolveTargetCapabilities(MEGA))

const group = (over: Partial<ModbusIOGroup>): ModbusIOGroup => ({
  id: 'g',
  name: 'Group',
  functionCode: '3',
  cycleTime: 100,
  offset: '0',
  length: 1,
  errorHandling: 'keep-last-value',
  ioPoints: [{ id: 'p', name: 'p', type: 'WORD', iecLocation: '%IW0' }],
  ...over,
})

const device = (name: string, config: Partial<ModbusRemoteTcpConfig>): PLCRemoteDevice => ({
  name,
  protocol: 'modbus-tcp',
  modbusTcpConfig: { slaveId: 1, timeout: 1000, ioGroups: [group({})], ...config },
})

const TCP = (name: string, host: string, slaveId = 1): PLCRemoteDevice =>
  device(name, { transport: 'tcp', host, port: 502, reconnect: true, slaveId })

const RTU = (name: string, serialPort: string, slaveId = 1): PLCRemoteDevice =>
  device(name, { transport: 'rtu', serialPort, baudRate: 19200, parity: 'E', stopBits: 1, dataBits: 8, slaveId })

const EVERY_FUNCTION_CODE = device('Every FC', {
  transport: 'tcp',
  host: '10.0.0.9',
  port: 502,
  reconnect: false,
  ioGroups: [
    group({ id: 'fc1', functionCode: '1', ioPoints: [{ id: 'a', name: 'a', type: 'BOOL', iecLocation: '%IX0.0' }] }),
    group({ id: 'fc2', functionCode: '2', ioPoints: [{ id: 'b', name: 'b', type: 'BOOL', iecLocation: '%IX0.1' }] }),
    group({ id: 'fc3', functionCode: '3', ioPoints: [{ id: 'c', name: 'c', type: 'WORD', iecLocation: '%IW1' }] }),
    group({ id: 'fc4', functionCode: '4', ioPoints: [{ id: 'd', name: 'd', type: 'WORD', iecLocation: '%IW2' }] }),
    group({
      id: 'fc5',
      functionCode: '5',
      errorHandling: 'set-to-zero',
      ioPoints: [{ id: 'e', name: 'e', type: 'BOOL', iecLocation: '%QX0.0' }],
    }),
    group({ id: 'fc15', functionCode: '15', ioPoints: [{ id: 'f', name: 'f', type: 'BOOL', iecLocation: '%QX0.1' }] }),
    group({ id: 'fc6', functionCode: '6', ioPoints: [{ id: 'g', name: 'g', type: 'WORD', iecLocation: '%QW0' }] }),
    group({ id: 'fc16', functionCode: '16', ioPoints: [{ id: 'h', name: 'h', type: 'WORD', iecLocation: '%QW1' }] }),
  ],
})

const FIXTURES: Array<[string, PLCRemoteDevice[], Record<string, string>]> = [
  ['TCP only', [TCP('Pump', '192.168.1.20')], {}],
  ['RTU only with an RS-485 pin', [RTU('Drive', 'Serial1')], { Serial1: '22' }],
  ['RTU only without an RS-485 pin', [RTU('Drive', 'Serial2')], {}],
  [
    'a shared endpoint and a shared bus',
    [TCP('A', '10.0.0.5'), TCP('B', '10.0.0.5', 2), RTU('C', 'Serial1'), RTU('D', 'Serial1', 2)],
    {},
  ],
  ['every function code and both error modes', [EVERY_FUNCTION_CODE, RTU('Drive', 'Serial3')], { Serial3: '22' }],
  ['a device with no groups', [device('Idle', { transport: 'tcp', host: '10.0.0.7', port: 502, ioGroups: [] })], {}],
  ['a hostile device name', [TCP('Pump */ int injected = 1; /*\n#define MB_MASTER_ENABLED 0\n// \\', '10.0.0.8')], {}],
]

/** Compiles `configHeader` with the firmware's types header; `output` holds what the compiler printed. */
function compile(configHeader: string): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mb-master-host-'))
  try {
    writeFileSync(join(dir, 'Arduino.h'), ARDUINO_STAND_IN)
    writeFileSync(join(dir, 'modbus_master_config.h'), configHeader)
    copyFileSync(join(ARDUINO_DIR, 'modbus_master_types.h'), join(dir, 'modbus_master_types.h'))
    writeFileSync(join(dir, 'tu.cpp'), TRANSLATION_UNIT)
    const run = spawnSync('g++', ['-std=gnu++11', '-fsyntax-only', '-I', dir, join(dir, 'tu.cpp')], {
      encoding: 'utf-8',
    })
    return { ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}${run.error?.message ?? ''}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const describeHostCompile = process.env.MB_MASTER_HOST_COMPILE === '1' ? describe : describe.skip

describeHostCompile('modbus_master_config.h compiles on the host with modbus_master_types.h', () => {
  it('compiles the skeleton stub', () => {
    expect(compile(readFileSync(join(ARDUINO_DIR, 'modbus_master_config.h'), 'utf-8'))).toMatchObject({ ok: true })
  })

  it.each(FIXTURES)('compiles the generated header for %s', (_case, devices, rs485Pins) => {
    const board = { serialPorts: MEGA.serialPorts, defaultSerial: MEGA.defaultSerial, rs485Pins }
    const generated = generateModbusMasterHeader({ devices, profile: PROFILE, board, rs485Pins })
    if (!generated.ok) throw new Error(`the fixture was refused: ${JSON.stringify(generated.issues)}`)

    expect(compile(generated.header)).toMatchObject({ ok: true })
  })
})
