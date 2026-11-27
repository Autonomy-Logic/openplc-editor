import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BoardInfo, ModbusIOGroup, PLCRemoteDevice } from '@root/middleware/shared/ports/types'
import { resolveModbusMasterProfile } from '@root/middleware/shared/utils/modbus-master-profile'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'

import { generateModbusMasterHeader } from '../generate-modbus-master-header'

const FIRMWARE_ROOTS = [
  join(__dirname, '..', '..', '..', '..', '..', 'resources', 'sources'),
  join(__dirname, '..', '..', '..', '..', 'assets', 'firmware'),
]

const FIRMWARE_ROOT =
  FIRMWARE_ROOTS.find((candidate) => existsSync(join(candidate, 'arduino', 's7comm_config.h'))) ?? FIRMWARE_ROOTS[0]

const BAREMETAL_DIR = join(FIRMWARE_ROOT, 'Baremetal')
const ARDUINO_DIR = join(FIRMWARE_ROOT, 'arduino')

/** The master sources the harness compiles unchanged. */
const MASTER_SOURCES = [
  'modbus_master.cpp',
  'modbus_master_tcp.cpp',
  'modbus_master.h',
  'modbus_master_tcp.h',
  'modbus_master_rtu.h',
  'modbus_master_util.h',
]

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

const G1: ModbusIOGroup = {
  id: 'g1',
  name: 'g1',
  functionCode: '3',
  cycleTime: 100,
  offset: '0',
  length: 10,
  errorHandling: 'set-to-zero',
  ioPoints: Array.from({ length: 10 }, (_, index) => ({
    id: `g1_${index}`,
    name: `g1_${index}`,
    type: 'WORD',
    iecLocation: `%IW${index}`,
  })),
}

/** The `modbus_master_config.h` of one device on 192.168.1.50:502, timeout 500 ms, with `reconnect`. */
function masterConfig(reconnect: boolean): string {
  const device: PLCRemoteDevice = {
    name: 'Slave',
    protocol: 'modbus-tcp',
    modbusTcpConfig: {
      transport: 'tcp',
      host: '192.168.1.50',
      port: 502,
      reconnect,
      slaveId: 1,
      timeout: 500,
      ioGroups: [G1],
    },
  }
  const generated = generateModbusMasterHeader({
    devices: [device],
    profile: PROFILE,
    board: { serialPorts: MEGA.serialPorts, defaultSerial: MEGA.defaultSerial },
    rs485Pins: {},
  })
  if (!generated.ok) throw new Error(`the fixture was refused: ${JSON.stringify(generated.issues)}`)
  return generated.header
}

const ARDUINO_STAND_IN = String.raw`#ifndef ARDUINO_STAND_IN_H
#define ARDUINO_STAND_IN_H
#include <stddef.h>
#include <stdint.h>
#include <string.h>
class HardwareSerial
{
public:
    void begin(unsigned long) {}
};
unsigned long millis();
#endif
`

const MODBUS_TYPES_STAND_IN = String.raw`#ifndef MODBUS_TYPES_H
#define MODBUS_TYPES_H
#include <Arduino.h>
#define MAX_MB_FRAME 272
enum
{
    MB_FC_READ_COILS = 0x01,
    MB_FC_READ_INPUT_STAT = 0x02,
    MB_FC_READ_REGS = 0x03,
    MB_FC_READ_INPUT_REGS = 0x04,
    MB_FC_WRITE_COIL = 0x05,
    MB_FC_WRITE_REG = 0x06,
    MB_FC_WRITE_COILS = 0x0F,
    MB_FC_WRITE_REGS = 0x10
};
#endif
`

const GLUE_STAND_IN = String.raw`#ifndef ARDUINO_RUNTIME_GLUE_H
#define ARDUINO_RUNTIME_GLUE_H
#include <stdint.h>
typedef enum
{
    OPENPLC_AREA_BOOL_INPUT = 0,
    OPENPLC_AREA_BOOL_OUTPUT = 1,
    OPENPLC_AREA_INT_INPUT = 2,
    OPENPLC_AREA_INT_OUTPUT = 3,
    OPENPLC_AREA_NONE = 9
} openplc_image_area_t;
void *openplc_image_slot(openplc_image_area_t area, uint16_t index, uint8_t *width);
uint8_t *openplc_image_bit(openplc_image_area_t area, uint16_t bit_index);
#endif
`

const OPENPLC_STAND_IN = String.raw`#ifndef OPENPLC_H
#define OPENPLC_H
#include <stdint.h>
#define PLC_STATE_RUNNING 1
uint8_t runtime_get_plc_state(void);
#endif
`

const PDU_STAND_IN = String.raw`#ifndef MODBUS_PDU_H
#define MODBUS_PDU_H
#include <stdint.h>
int32_t mb_pdu_response_len(uint8_t fc, uint16_t quantity);
#endif
`

const NET_STAND_IN = String.raw`#ifndef BAREMETAL_NET_H
#define BAREMETAL_NET_H
#include <stddef.h>
#include <stdint.h>
#include "modbus_master_config.h"
#define BM_NET_CLOSE_WAITS 0
namespace bm_net {
enum ConnStatus : uint8_t
{
    BM_CONN_CLOSED,
    BM_CONN_PENDING,
    BM_CONN_CONNECTED,
    BM_CONN_FAILED
};
enum SendResult : uint8_t
{
    BM_SEND_OK,
    BM_SEND_NO_ROOM,
    BM_SEND_LOST
};
bool link_up();
class Connection
{
public:
    Connection();
    bool start(const uint8_t ip[4], uint16_t port, uint32_t timeout_ms);
    ConnStatus poll();
    int read(uint8_t *buf, size_t cap);
    SendResult send(const uint8_t *buf, size_t len);
    void close();
};
}
#endif
`

/**
 * The driver: fakes of the network seam, the clock, the PLC state, the image and the PDU lengths, and one scenario
 * per run, named by argv[1]. Each pass commits, samples and runs the master, then moves the clock 10 ms. It prints
 * a JSON array of events: connect starts, failures, closes, link queries, sends and the g1 image after each change.
 */
const DRIVER = String.raw`#include <stdio.h>
#include <string.h>
#include "Arduino.h"
#include "arduino_runtime_glue.h"
#include "baremetal_net.h"
#include "modbus_master.h"
#include "modbus_pdu.h"
#include "openplc.h"

enum ConnectMode { REFUSE, ACCEPT, PEND_THEN_FAIL };

struct Scenario
{
    const char *name;
    bool (*link_at)(uint32_t t);
    ConnectMode (*mode_at)(uint32_t t);
    void (*on_send)(uint32_t request, uint16_t tid);
    uint32_t end_ms;
};

struct Chunk
{
    uint32_t due;
    uint16_t len;
    uint8_t bytes[96];
};

static uint32_t g_now = 0;
static bool g_link = false;
static ConnectMode g_mode = REFUSE;
static int g_status = bm_net::BM_CONN_CLOSED;
static int g_polls_left = 0;
static bool g_announced = false;
static uint32_t g_requests = 0;
static int g_pass_queries = 0;
static int g_max_queries = 0;
static uint16_t g_iw[16];
static Chunk g_rx[32];
static int g_rx_count = 0;
static const Scenario *g_scenario = 0;
static uint16_t g_held_tid = 0;
static bool g_first_event = true;

unsigned long millis()
{
    return g_now;
}

uint8_t runtime_get_plc_state(void)
{
    return PLC_STATE_RUNNING;
}

void *openplc_image_slot(openplc_image_area_t area, uint16_t index, uint8_t *width)
{
    if (area == OPENPLC_AREA_INT_INPUT && index < 16)
    {
        *width = 2;
        return &g_iw[index];
    }
    *width = 0;
    return NULL;
}

uint8_t *openplc_image_bit(openplc_image_area_t, uint16_t)
{
    return NULL;
}

int32_t mb_pdu_response_len(uint8_t fc, uint16_t quantity)
{
    switch (fc)
    {
        case 1:
        case 2:
            return 5 + (int32_t)((quantity + 7u) / 8u);
        case 3:
        case 4:
            return 5 + 2 * (int32_t)quantity;
        case 5:
        case 6:
        case 15:
        case 16:
            return 8;
        default:
            return -1;
    }
}

static void event(const char *kind, const char *fields)
{
    printf("%s{\"t\":%u,\"ev\":\"%s\"%s%s}\n", g_first_event ? "" : ",", (unsigned)g_now, kind, fields[0] ? "," : "",
           fields);
    g_first_event = false;
}

static void queue(uint32_t delay, const uint8_t *bytes, uint16_t len)
{
    Chunk &chunk = g_rx[g_rx_count++];
    chunk.due = g_now + delay;
    chunk.len = len;
    memcpy(chunk.bytes, bytes, len);
}

static uint16_t answer(uint8_t *out, uint16_t tid, uint16_t first)
{
    out[0] = (uint8_t)(tid >> 8);
    out[1] = (uint8_t)tid;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 23;
    out[6] = 1;
    out[7] = 3;
    out[8] = 20;
    for (int i = 0; i < 10; i++)
    {
        out[9 + 2 * i] = (uint8_t)((first + i) >> 8);
        out[10 + 2 * i] = (uint8_t)(first + i);
    }
    return 29;
}

static void answer_with(uint16_t tid, uint16_t first)
{
    uint8_t frame[29];
    queue(10, frame, answer(frame, tid, first));
}

namespace bm_net {

bool link_up()
{
    g_pass_queries++;
    char fields[32];
    snprintf(fields, sizeof(fields), "\"up\":%d", g_link ? 1 : 0);
    event("link", fields);
    return g_link;
}

Connection::Connection()
{
}

bool Connection::start(const uint8_t[4], uint16_t, uint32_t)
{
    char fields[48];
    bool ok = g_link && g_mode != REFUSE;
    snprintf(fields, sizeof(fields), "\"ok\":%d,\"up\":%d", ok ? 1 : 0, g_link ? 1 : 0);
    event("start", fields);
    g_announced = false;
    g_rx_count = 0;
    if (!ok)
    {
        g_status = BM_CONN_FAILED;
        return false;
    }
    g_status = g_mode == ACCEPT ? BM_CONN_CONNECTED : BM_CONN_PENDING;
    g_polls_left = 1;
    return true;
}

ConnStatus Connection::poll()
{
    if (g_status == BM_CONN_PENDING)
    {
        if (g_polls_left > 0)
        {
            g_polls_left--;
            return BM_CONN_PENDING;
        }
        g_status = BM_CONN_FAILED;
        event("failed", "");
        return BM_CONN_FAILED;
    }
    if (g_status == BM_CONN_CONNECTED && !g_announced)
    {
        g_announced = true;
        event("connected", "");
    }
    return (ConnStatus)g_status;
}

int Connection::read(uint8_t *buf, size_t cap)
{
    size_t got = 0;
    int kept = 0;
    for (int i = 0; i < g_rx_count; i++)
    {
        Chunk &chunk = g_rx[i];
        if (chunk.due <= g_now && got + chunk.len <= cap)
        {
            memcpy(&buf[got], chunk.bytes, chunk.len);
            got += chunk.len;
        }
        else
        {
            g_rx[kept++] = chunk;
        }
    }
    g_rx_count = kept;
    return (int)got;
}

SendResult Connection::send(const uint8_t *buf, size_t)
{
    const uint16_t tid = (uint16_t)((buf[0] << 8) | buf[1]);
    char fields[32];
    snprintf(fields, sizeof(fields), "\"tid\":%u", (unsigned)tid);
    event("send", fields);
    g_requests++;
    if (g_scenario->on_send)
        g_scenario->on_send(g_requests, tid);
    return BM_SEND_OK;
}

void Connection::close()
{
    event("close", "");
    g_status = BM_CONN_CLOSED;
    g_rx_count = 0;
}

}

static bool link_from_60s(uint32_t t)
{
    return t >= 60000;
}

static bool link_always(uint32_t)
{
    return true;
}

static bool link_down_1500_to_4000(uint32_t t)
{
    return t < 1500 || t >= 4000;
}

static bool link_down_10_to_1000(uint32_t t)
{
    return t < 10 || t >= 1000;
}

static ConnectMode refuse(uint32_t)
{
    return REFUSE;
}

static ConnectMode accept(uint32_t)
{
    return ACCEPT;
}

static ConnectMode pend_then_accept(uint32_t t)
{
    return t < 1000 ? PEND_THEN_FAIL : ACCEPT;
}

static ConnectMode pend_then_refuse(uint32_t t)
{
    return t < 1000 ? PEND_THEN_FAIL : REFUSE;
}

static void answer_all(uint32_t, uint16_t tid)
{
    answer_with(tid, 101);
}

static void truncated_then_silence(uint32_t request, uint16_t tid)
{
    if (request <= 3)
    {
        answer_with(tid, 101);
    }
    else if (request == 4)
    {
        uint8_t frame[29];
        answer(frame, tid, 201);
        queue(10, frame, 15);
    }
    else
    {
        answer_with(tid, 501);
    }
}

static void exception_then_truncated_silence(uint32_t request, uint16_t tid)
{
    if (request <= 3)
    {
        answer_with(tid, 101);
    }
    else if (request == 4)
    {
        uint8_t frame[9] = {(uint8_t)(tid >> 8), (uint8_t)tid, 0, 0, 0, 3, 1, 0x83, 0x02};
        queue(10, frame, 9);
    }
    else if (request == 5)
    {
        uint8_t frame[29];
        answer(frame, tid, 201);
        queue(10, frame, 15);
    }
    else
    {
        answer_with(tid, 501);
    }
}

static void late_valid_answer(uint32_t request, uint16_t tid)
{
    if (request <= 3)
    {
        answer_with(tid, 101);
    }
    else if (request == 4)
    {
        g_held_tid = tid;
    }
    else if (request == 5)
    {
        uint8_t frames[58];
        answer(frames, g_held_tid, 201);
        answer(&frames[29], tid, 501);
        queue(10, frames, 58);
    }
    else
    {
        answer_with(tid, 501);
    }
}

static void truncated_then_remainder(uint32_t request, uint16_t tid)
{
    if (request <= 3)
    {
        answer_with(tid, 101);
    }
    else if (request == 4)
    {
        g_held_tid = tid;
        uint8_t frame[29];
        answer(frame, tid, 201);
        queue(10, frame, 15);
    }
    else if (request == 5)
    {
        uint8_t frames[43];
        uint8_t held[29];
        answer(held, g_held_tid, 201);
        memcpy(frames, &held[15], 14);
        answer(&frames[14], tid, 501);
        queue(10, frames, 43);
    }
    else
    {
        answer_with(tid, 501);
    }
}

static const Scenario SCENARIOS[] = {
    {"S1", link_from_60s, refuse, 0, 361000},
    {"S2", link_from_60s, refuse, 0, 66000},
    {"S3a", link_down_1500_to_4000, refuse, 0, 10000},
    {"S3b-accept", link_down_10_to_1000, pend_then_accept, answer_all, 3000},
    {"S3b-refuse", link_down_10_to_1000, pend_then_refuse, 0, 5000},
    {"S4", link_always, refuse, 0, 130000},
    {"S5", link_always, accept, truncated_then_silence, 2000},
    {"S6", link_always, accept, late_valid_answer, 2000},
    {"S7", link_always, accept, truncated_then_remainder, 3000},
    {"S9", link_always, accept, exception_then_truncated_silence, 2000},
};

int main(int argc, char **argv)
{
    for (size_t i = 0; i < sizeof(SCENARIOS) / sizeof(SCENARIOS[0]); i++)
    {
        if (argc > 1 && strcmp(argv[1], SCENARIOS[i].name) == 0)
            g_scenario = &SCENARIOS[i];
    }
    if (g_scenario == 0)
    {
        fprintf(stderr, "unknown scenario\n");
        return 2;
    }
    uint16_t shown[10];
    bool shown_once = false;
    printf("[\n");
    for (g_now = 0; g_now <= g_scenario->end_ms; g_now += 10)
    {
        g_link = g_scenario->link_at(g_now);
        g_mode = g_scenario->mode_at(g_now);
        g_pass_queries = 0;
        mb_master_commit_inputs();
        if (!shown_once || memcmp(shown, g_iw, sizeof(shown)) != 0)
        {
            memcpy(shown, g_iw, sizeof(shown));
            shown_once = true;
            char fields[160];
            int at = snprintf(fields, sizeof(fields), "\"v\":[");
            for (int i = 0; i < 10; i++)
                at += snprintf(&fields[at], sizeof(fields) - at, "%s%u", i ? "," : "", (unsigned)g_iw[i]);
            snprintf(&fields[at], sizeof(fields) - at, "]");
            event("image", fields);
        }
        mb_master_sample_outputs();
        mb_master_task();
        if (g_pass_queries > g_max_queries)
            g_max_queries = g_pass_queries;
    }
    char fields[48];
    snprintf(fields, sizeof(fields), "\"maxQueriesPerPass\":%d", g_max_queries);
    event("end", fields);
    printf("]\n");
    return 0;
}
`

type TraceEvent = {
  t: number
  ev: 'start' | 'failed' | 'connected' | 'close' | 'link' | 'send' | 'image' | 'end'
  ok?: 0 | 1
  up?: 0 | 1
  tid?: number
  v?: number[]
  maxQueriesPerPass?: number
}

/** The driver binaries: one built with Reconnect off, one with Reconnect on. */
type Binaries = { off: string; on: string }

/** Copies the master sources unchanged next to the stand-ins and builds the driver for both Reconnect settings. */
function build(dir: string): Binaries {
  for (const name of MASTER_SOURCES) copyFileSync(join(BAREMETAL_DIR, name), join(dir, name))
  copyFileSync(join(ARDUINO_DIR, 'modbus_master_types.h'), join(dir, 'modbus_master_types.h'))
  writeFileSync(join(dir, 'Arduino.h'), ARDUINO_STAND_IN)
  writeFileSync(join(dir, 'modbus_types.h'), MODBUS_TYPES_STAND_IN)
  writeFileSync(join(dir, 'arduino_runtime_glue.h'), GLUE_STAND_IN)
  writeFileSync(join(dir, 'openplc.h'), OPENPLC_STAND_IN)
  writeFileSync(join(dir, 'modbus_pdu.h'), PDU_STAND_IN)
  writeFileSync(join(dir, 'baremetal_net.h'), NET_STAND_IN)
  writeFileSync(join(dir, 'driver.cpp'), DRIVER)

  const binaries: Binaries = { off: join(dir, 'driver-reconnect-off'), on: join(dir, 'driver-reconnect-on') }
  for (const [reconnect, binary] of [
    [false, binaries.off],
    [true, binaries.on],
  ] as const) {
    writeFileSync(join(dir, 'modbus_master_config.h'), masterConfig(reconnect))
    const run = spawnSync(
      'g++',
      [
        '-std=gnu++11',
        '-Wall',
        '-I',
        dir,
        '-o',
        binary,
        join(dir, 'driver.cpp'),
        join(dir, 'modbus_master.cpp'),
        join(dir, 'modbus_master_tcp.cpp'),
      ],
      { encoding: 'utf-8', env: { ...process.env, LC_ALL: 'C', LANG: 'C' } },
    )
    if (run.status !== 0) {
      throw new Error(`the master did not build on the host:\n${run.stderr ?? ''}${run.error?.message ?? ''}`)
    }
  }
  return binaries
}

/** The trace of one scenario of the driver. */
function runScenario(binary: string, scenario: string): TraceEvent[] {
  const run = spawnSync(binary, [scenario], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(`scenario ${scenario} failed:\n${run.stderr ?? ''}${run.error?.message ?? ''}`)
  const events: TraceEvent[] = JSON.parse(run.stdout)
  return events
}

const startsOf = (trace: TraceEvent[]): number[] => trace.filter((e) => e.ev === 'start').map((e) => e.t)

const intervalsOf = (times: number[]): number[] => times.slice(1).map((time, index) => time - times[index])

const maxQueriesPerPass = (trace: TraceEvent[]): number | undefined =>
  trace.find((e) => e.ev === 'end')?.maxQueriesPerPass

/** Whether every interval is within one 10 ms pass of the expected one. */
const withinOnePass = (actual: number[], expected: number[]): boolean =>
  actual.length >= expected.length && expected.every((interval, index) => Math.abs(actual[index] - interval) <= 10)

/** The failed connects (start refused, or a pending connect failed) not followed by a close() before the next start. */
function unclosedFailures(trace: TraceEvent[]): number[] {
  const unclosed: number[] = []
  let owed: number | null = null
  for (const e of trace) {
    if (e.ev === 'close') owed = null
    if (e.ev === 'start' && owed !== null) unclosed.push(owed)
    if ((e.ev === 'start' && e.ok === 0) || e.ev === 'failed') owed = e.t
  }
  if (owed !== null) unclosed.push(owed)
  return unclosed
}

/** The g1 values after each change, in order, as the first value of the group (0, 101, 201 or 501). */
const imagesOf = (trace: TraceEvent[]): Array<{ t: number; first: number; all: number[] }> =>
  trace.filter((e) => e.ev === 'image').map((e) => ({ t: e.t, first: e.v?.[0] ?? -1, all: e.v ?? [] }))

const range = (first: number): number[] => Array.from({ length: 10 }, (_, index) => first + index)

const describeHostCompile = process.env.MB_MASTER_HOST_COMPILE === '1' ? describe : describe.skip

describeHostCompile('modbus_master_tcp.cpp waits for the network link before a connect (MT-7)', () => {
  let dir = ''
  let binaries: Binaries = { off: '', on: '' }
  const traces = new Map<string, TraceEvent[]>()

  const trace = (reconnect: 'off' | 'on', scenario: string): TraceEvent[] => {
    const key = `${reconnect}:${scenario}`
    const cached = traces.get(key)
    if (cached !== undefined) return cached
    const fresh = runScenario(binaries[reconnect], scenario)
    traces.set(key, fresh)
    return fresh
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mb-master-tcp-link-'))
    binaries = build(dir)
  }, 120_000)

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
  })

  describe('S1: link down for 60 s, Reconnect off', () => {
    it('starts no connect while the link is down', () => {
      expect(startsOf(trace('off', 'S1')).filter((t) => t < 60000)).toEqual([])
    })

    it('asks for the link at most once per pass', () => {
      expect(maxQueriesPerPass(trace('off', 'S1'))).toBeLessThanOrEqual(1)
    })

    it('starts exactly one connect in the pass the link comes up or the next', () => {
      expect(startsOf(trace('off', 'S1')).filter((t) => t >= 60000 && t <= 60010)).toHaveLength(1)
    })

    it('gives the device up after that connect is refused with the link up: no start for 300 s', () => {
      expect(startsOf(trace('off', 'S1')).filter((t) => t > 60010)).toEqual([])
    })
  })

  describe('S2: link down for 60 s, Reconnect on', () => {
    it('starts no connect while the link is down', () => {
      expect(startsOf(trace('on', 'S2')).filter((t) => t < 60000)).toEqual([])
    })

    it('asks for the link at most once per pass', () => {
      expect(maxQueriesPerPass(trace('on', 'S2'))).toBeLessThanOrEqual(1)
    })

    it('connects at once when the link comes up, then retries 2000 ms after a refusal with the link up', () => {
      const starts = startsOf(trace('on', 'S2')).filter((t) => t >= 60000)
      expect({
        first: starts[0] !== undefined && starts[0] <= 60010,
        retry: withinOnePass(intervalsOf(starts.slice(0, 2)), [2000]),
      }).toEqual({ first: true, retry: true })
    })
  })

  describe('S3: a connect fails while the link reads down', () => {
    it('Reconnect off, pending connect fails with the link down: closes it and is not given up', () => {
      const run = trace('off', 'S3b-accept')
      const failure = run.find((e) => e.ev === 'failed')
      expect({
        failedAt: failure?.t,
        unclosed: unclosedFailures(run),
        startsWhileDown: startsOf(run).filter((t) => t > 0 && t < 1000),
        startAtLinkUp: startsOf(run).some((t) => t >= 1000 && t <= 1010),
        connected: run.some((e) => e.ev === 'connected' && e.t >= 1000),
      }).toEqual({ failedAt: 10, unclosed: [], startsWhileDown: [], startAtLinkUp: true, connected: true })
    })

    it('Reconnect on, pending connect fails with the link down: closes it and keeps the 2000 ms delay', () => {
      const run = trace('on', 'S3b-refuse')
      const afterLinkUp = startsOf(run).filter((t) => t >= 1000)
      expect({
        unclosed: unclosedFailures(run),
        startsWhileDown: startsOf(run).filter((t) => t > 0 && t < 1000),
        startAtLinkUp: afterLinkUp[0] !== undefined && afterLinkUp[0] <= 1010,
        delayKept: withinOnePass(intervalsOf(afterLinkUp.slice(0, 2)), [2000]),
      }).toEqual({ unclosed: [], startsWhileDown: [], startAtLinkUp: true, delayKept: true })
    })

    it('Reconnect on, connect due while the link is down: no attempt counted, the 3000 ms delay kept', () => {
      const run = trace('on', 'S3a')
      const afterLinkUp = startsOf(run).filter((t) => t >= 4000)
      expect({
        unclosed: unclosedFailures(run),
        startsWhileDown: startsOf(run).filter((t) => t >= 1500 && t < 4000),
        startAtLinkUp: afterLinkUp[0] !== undefined && afterLinkUp[0] <= 4010,
        delayKept: withinOnePass(intervalsOf(afterLinkUp.slice(0, 2)), [3000]),
      }).toEqual({ unclosed: [], startsWhileDown: [], startAtLinkUp: true, delayKept: true })
    })
  })

  describe('S4 (regression guard): every connect refused with the link up, Reconnect on', () => {
    it('waits 2 s, then 1.5 times longer each time, up to 30 s', () => {
      const intervals = intervalsOf(startsOf(trace('on', 'S4')))
      const expected = [2000, 3000, 4500, 6750, 10125, 15187, 22780, 30000, 30000]
      expect({ intervals: intervals.slice(0, expected.length), ok: withinOnePass(intervals, expected) }).toMatchObject({
        ok: true,
      })
    })

    it('asks for the link only in the passes that start a connect', () => {
      const run = trace('on', 'S4')
      const starts = new Set(startsOf(run))
      expect(run.filter((e) => e.ev === 'link' && !starts.has(e.t)).map((e) => e.t)).toEqual([])
    })
  })

  describe('S5 (regression guard): a truncated frame then silence, Reconnect off', () => {
    it('reads 101..110, then 0 once the 500 ms timeout passes, then 501..510 on the next request', () => {
      const run = trace('off', 'S5')
      const sends = run.filter((e) => e.ev === 'send').map((e) => e.t)
      const images = imagesOf(run).filter((image) => image.t > 0)
      const zero = images.find((image) => image.first === 0)
      expect({
        values: images.map((image) => image.first),
        baseline: images[0]?.all,
        recovered: images[2]?.all,
        zeroAfterTimeout: zero !== undefined && zero.t >= sends[3] + 500 && zero.t <= sends[3] + 520,
      }).toEqual({ values: [101, 0, 501], baseline: range(101), recovered: range(501), zeroAfterTimeout: true })
    })

    it('keeps the connection: no close()', () => {
      expect(trace('off', 'S5').filter((e) => e.ev === 'close')).toEqual([])
    })
  })

  describe('S6 (regression guard): the valid answer of a timed-out request arrives after the next request', () => {
    it('never reads the late 201..210 and reads 501..510', () => {
      const values = imagesOf(trace('off', 'S6')).map((image) => image.first)
      expect({ late: values.includes(201), recovered: values.includes(501) }).toEqual({ late: false, recovered: true })
    })

    it('keeps the connection: no close()', () => {
      expect(trace('off', 'S6').filter((e) => e.ev === 'close')).toEqual([])
    })
  })

  describe('S7 (regression guard): the rest of a truncated frame arrives after the next request', () => {
    it('costs at most one more failed poll, then reads 501..510, never 201..', () => {
      const run = trace('off', 'S7')
      const sends = run.filter((e) => e.ev === 'send').map((e) => e.t)
      const recovered = imagesOf(run).find((image) => image.first === 501)
      const requestsUntilRecovered =
        recovered === undefined ? Infinity : sends.filter((t) => t >= sends[4] && t < recovered.t).length
      expect({
        late: imagesOf(run).some((image) => image.first === 201),
        recovered: recovered?.all,
        withinOneMorePoll: requestsUntilRecovered <= 2,
      }).toEqual({ late: false, recovered: range(501), withinOneMorePoll: true })
    })

    it('keeps the connection: no close()', () => {
      expect(trace('off', 'S7').filter((e) => e.ev === 'close')).toEqual([])
    })
  })

  describe('S9: a failed poll with Reconnect on keeps the connection (BR30, TC34)', () => {
    it('an exception answer and a truncated answer then silence each fail one poll, then 501..510 arrives on the same connection: no close(), one connect', () => {
      const run = trace('on', 'S9')
      const sends = run.filter((e) => e.ev === 'send').map((e) => e.t)
      const images = imagesOf(run).filter((image) => image.t > 0)
      const zero = images.find((image) => image.first === 0)
      const recovered = images.find((image) => image.first === 501)
      expect({
        closes: run.filter((e) => e.ev === 'close'),
        startCount: startsOf(run).length,
        values: images.map((image) => image.first),
        recovered: images[2]?.all,
        zeroAtException: zero !== undefined && zero.t > sends[3] && zero.t <= sends[3] + 30,
        recoveredAfterTimeout: recovered !== undefined && recovered.t >= sends[4] + 500,
      }).toEqual({
        closes: [],
        startCount: 1,
        values: [101, 0, 501],
        recovered: range(501),
        zeroAtException: true,
        recoveredAfterTimeout: true,
      })
    })
  })

  describe('S8: no link query while connected', () => {
    it('asks for the link in no pass after the connection is up', () => {
      const run = trace('off', 'S5')
      const connected = run.find((e) => e.ev === 'connected')
      expect({
        connected: connected !== undefined,
        queries: run.filter((e) => e.ev === 'link' && connected !== undefined && e.t > connected.t).map((e) => e.t),
      }).toEqual({ connected: true, queries: [] })
    })
  })
})
