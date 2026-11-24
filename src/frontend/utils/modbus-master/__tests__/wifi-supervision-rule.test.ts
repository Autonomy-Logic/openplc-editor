import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FIRMWARE_ROOTS = [
  join(__dirname, '..', '..', '..', '..', '..', 'resources', 'sources'),
  join(__dirname, '..', '..', '..', '..', 'assets', 'firmware'),
]

const FIRMWARE_ROOT =
  FIRMWARE_ROOTS.find((candidate) => existsSync(join(candidate, 'arduino', 's7comm_config.h'))) ?? FIRMWARE_ROOTS[0]

const BAREMETAL_DIR = join(FIRMWARE_ROOT, 'Baremetal')

/** The pure rule and the one header it may include, compiled unchanged. */
const RULE_SOURCES = ['wifi_supervision.h', 'modbus_master_util.h']

const QUIET_MS = 60_000

/** WIFI_STAMP_AHEAD_MAX_MS of wifi_supervision.h. */
const AHEAD_MAX_MS = 1_000

const U32_MAX = 0xffffffff

/**
 * The driver. `cases h j now quiet ...` prints a JSON array with `wifi_reconnect_due()` for each group of four
 * arguments. `quiet now event window ...` prints `wifi_quiet_start()` for each group of three. `step h j now event
 * window` prints `[due, window after]` of one `wifi_supervise_step()` call. `timeline duration joinFrom joinTo
 * addressFrom addressTo event...` plays a station on a 10 ms step from the first supervision call at 0 ms: each pass
 * calls `wifi_supervise_step()` with the latest event stamp read by then, where an event is `stamp` (read from the
 * pass at `stamp` on) or `stamp/seen` (read from the pass at `seen` on). It prints the passes that were due.
 */
const DRIVER = String.raw`#include <stdio.h>
#include <stdlib.h>
#include "wifi_supervision.h"

static uint32_t arg_u32(const char *text)
{
    return (uint32_t)strtoul(text, NULL, 10);
}

static bool within(long t, long from, long to)
{
    return from >= 0 && t >= from && t < to;
}

static int cases(int argc, char **argv)
{
    printf("[");
    for (int i = 2; i + 3 < argc; i += 4)
    {
        bool due = wifi_reconnect_due(atoi(argv[i]) != 0, atoi(argv[i + 1]) != 0, arg_u32(argv[i + 2]), arg_u32(argv[i + 3]));
        printf("%s%d", i > 2 ? "," : "", due ? 1 : 0);
    }
    printf("]\n");
    return 0;
}

static int quiet(int argc, char **argv)
{
    printf("[");
    for (int i = 2; i + 2 < argc; i += 3)
    {
        uint32_t start = wifi_quiet_start(arg_u32(argv[i]), arg_u32(argv[i + 1]), arg_u32(argv[i + 2]));
        printf("%s%lu", i > 2 ? "," : "", (unsigned long)start);
    }
    printf("]\n");
    return 0;
}

static int step(int argc, char **argv)
{
    if (argc < 7)
        return 2;
    uint32_t window = arg_u32(argv[6]);
    bool due = wifi_supervise_step(atoi(argv[2]) != 0, atoi(argv[3]) != 0, arg_u32(argv[4]), arg_u32(argv[5]), &window);
    printf("[%d,%lu]\n", due ? 1 : 0, (unsigned long)window);
    return 0;
}

static long event_seen_at(const char *text, uint32_t *stamp)
{
    char *end = NULL;
    *stamp = (uint32_t)strtoul(text, &end, 10);
    return *end == '/' ? atol(end + 1) : (long)*stamp;
}

static int timeline(int argc, char **argv)
{
    if (argc < 7)
        return 2;
    long duration = atol(argv[2]);
    long join_from = atol(argv[3]);
    long join_to = atol(argv[4]);
    long address_from = atol(argv[5]);
    long address_to = atol(argv[6]);
    int next_event = 7;
    uint32_t last_event = 0;
    uint32_t window = 0;
    bool first = true;
    printf("[");
    for (long t = 0; t <= duration; t += 10)
    {
        while (next_event < argc)
        {
            uint32_t stamp = 0;
            if (event_seen_at(argv[next_event], &stamp) > t)
                break;
            last_event = stamp;
            next_event++;
        }
        bool has_address = within(t, address_from, address_to);
        bool joining = within(t, join_from, join_to);
        if (wifi_supervise_step(has_address, joining, (uint32_t)t, last_event, &window))
        {
            printf("%s%ld", first ? "" : ",", t);
            first = false;
        }
    }
    printf("]\n");
    return 0;
}

int main(int argc, char **argv)
{
    if (argc > 1 && argv[1][0] == 'c')
        return cases(argc, argv);
    if (argc > 1 && argv[1][0] == 't')
        return timeline(argc, argv);
    if (argc > 1 && argv[1][0] == 'q')
        return quiet(argc, argv);
    if (argc > 1 && argv[1][0] == 's')
        return step(argc, argv);
    return 2;
}
`

/** One call of the rule. */
type Case = { hasAddress: boolean; joining: boolean; now: number; quietSince: number }

/** A station event: its stamp, and the pass from which the supervision reads it when that is not the stamp itself. */
type StationEvent = number | { stamp: number; seenAt: number }

/** A station seen from the supervision: when it is associating, when it has its address, when the driver posts. */
type Timeline = {
  durationMs: number
  joining?: [number, number]
  address?: [number, number]
  events: StationEvent[]
}

/** One call of wifi_quiet_start(), with the start of the quiet window it must return. */
type QuietCase = { now: number; event: number; window: number; start: number }

/** Copies the rule and its helper header unchanged next to the driver and builds it. */
function build(dir: string): string {
  for (const name of RULE_SOURCES) copyFileSync(join(BAREMETAL_DIR, name), join(dir, name))
  writeFileSync(join(dir, 'driver.cpp'), DRIVER)
  const binary = join(dir, 'driver')
  const run = spawnSync('g++', ['-std=gnu++11', '-Wall', '-I', dir, '-o', binary, join(dir, 'driver.cpp')], {
    encoding: 'utf-8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  })
  if (run.status !== 0) {
    throw new Error(`the rule did not build on the host:\n${run.stderr ?? ''}${run.error?.message ?? ''}`)
  }
  return binary
}

function runDriver(binary: string, args: string[]): number[] {
  const run = spawnSync(binary, args, { encoding: 'utf-8' })
  if (run.status !== 0) throw new Error(`the driver failed:\n${run.stderr ?? ''}${run.error?.message ?? ''}`)
  const values: number[] = JSON.parse(run.stdout)
  return values
}

/** Comments blanked but string literals kept, so quoted include names survive. */
const withoutComments = (source: string): string =>
  source
    .replace(/\\\r?\n/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, '')

/** The targets of every `#include` in `source`, as written, e.g. `<stdint.h>` or `"modbus_master_util.h"`. */
const includesOf = (source: string): string[] =>
  [...withoutComments(source).matchAll(/^[ \t]*#\s*include\s*([<"][^>"]+[>"])/gm)].map((match) => match[1])

const readRule = (): string => readFileSync(join(BAREMETAL_DIR, 'wifi_supervision.h'), 'utf-8')

describe('wifi_supervision.h is pure and host-compilable', () => {
  it('includes only <stdint.h> and "modbus_master_util.h"', () => {
    expect([...includesOf(readRule())].sort()).toEqual(['"modbus_master_util.h"', '<stdint.h>'])
  })

  it('names no Arduino or Wi-Fi identifier: WiFi, WL_, millis, Arduino', () => {
    const code = withoutComments(readRule())
    const named = [/\bWiFi\w*/, /\bWL_\w*/, /\bmillis\b/, /\bArduino\w*/]
      .map((pattern) => pattern.exec(code)?.[0])
      .filter((name): name is string => name !== undefined)
    expect(named).toEqual([])
  })

  it('opens with the SPDX line of the other firmware files', () => {
    expect(readRule().split('\n')[0]).toBe('// SPDX-License-Identifier: GPL-3.0-only')
  })
})

const describeHostCompile = process.env.MB_MASTER_HOST_COMPILE === '1' ? describe : describe.skip

/** Builds the driver in a temporary folder before the tests of the calling `describe` and removes it after them. */
function hostDriver(): () => string {
  let dir = ''
  let binary = ''

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mb-wifi-supervision-'))
    binary = build(dir)
  }, 120_000)

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
  })

  return () => binary
}

describeHostCompile('wifi_reconnect_due(): a reconnect only after 60 s of quiet on an idle station (CR12-1)', () => {
  const binary = hostDriver()

  const due = (cases: Case[]): boolean[] =>
    runDriver(binary(), [
      'cases',
      ...cases.flatMap((c) => [c.hasAddress ? '1' : '0', c.joining ? '1' : '0', String(c.now), String(c.quietSince)]),
    ]).map((value) => value === 1)

  it('is never due while the station has its address, whatever the times', () => {
    expect(
      due([
        { hasAddress: true, joining: false, now: 600_000, quietSince: 0 },
        { hasAddress: true, joining: true, now: 600_000, quietSince: 0 },
        { hasAddress: true, joining: false, now: QUIET_MS, quietSince: 0 },
        { hasAddress: true, joining: false, now: U32_MAX, quietSince: 0 },
        { hasAddress: true, joining: false, now: 39_999, quietSince: U32_MAX - 20_000 },
      ]),
    ).toEqual([false, false, false, false, false])
  })

  it('is never due while the station is associated or associating, even after 10 minutes of quiet', () => {
    expect(due([{ hasAddress: false, joining: true, now: 600_000, quietSince: 0 }])).toEqual([false])
  })

  it('is due on an idle station at exactly 60 000 ms of quiet, not at 59 999 ms', () => {
    expect(
      due([
        { hasAddress: false, joining: false, now: 1_000 + QUIET_MS - 1, quietSince: 1_000 },
        { hasAddress: false, joining: false, now: 1_000 + QUIET_MS, quietSince: 1_000 },
      ]),
    ).toEqual([false, true])
  })

  it('counts the quiet time across the millis() wrap: due exactly 60 000 ms after a window started near 0xFFFFFFFF', () => {
    const quietSince = U32_MAX - 20_000
    const dueAt = (quietSince + QUIET_MS) % 2 ** 32
    expect(
      due([
        { hasAddress: false, joining: false, now: U32_MAX, quietSince },
        { hasAddress: false, joining: false, now: dueAt - 1, quietSince },
        { hasAddress: false, joining: false, now: dueAt, quietSince },
      ]),
    ).toEqual([false, false, true])
  })
})

const NOW_AHEAD = 0x90000000

const QUIET_CASES: Array<[string, QuietCase]> = [
  ['an event newer than the window: the event', { now: 100_000, event: 95_000, window: 0, start: 95_000 }],
  ['a window newer than the event: the window', { now: 100_000, event: 0, window: 95_000, start: 95_000 }],
  [
    'a window started near the wrap and an event after it: the event',
    { now: 0x00000200, event: 0x00000100, window: 0xffffff00, start: 0x00000100 },
  ],
  ['an event one tick ahead of now: the event', { now: 1_000, event: 1_001, window: 900, start: 1_001 }],
  [
    'an event exactly WIFI_STAMP_AHEAD_MAX_MS ahead of now: the event',
    { now: 100_000, event: 100_000 + AHEAD_MAX_MS, window: 99_000, start: 100_000 + AHEAD_MAX_MS },
  ],
  [
    'an event WIFI_STAMP_AHEAD_MAX_MS + 1 ahead of now, taken as about 49.7 days old: the window',
    { now: 100_000, event: 100_000 + AHEAD_MAX_MS + 1, window: 99_000, start: 99_000 },
  ],
  [
    'an event older than 24.8 days: the window',
    { now: NOW_AHEAD, event: NOW_AHEAD - 0x80000010, window: NOW_AHEAD - 30_000, start: NOW_AHEAD - 30_000 },
  ],
  ['both ahead, the window further: the window', { now: 1_000, event: 1_005, window: 1_500, start: 1_500 }],
  ['both ahead, the event further: the event', { now: 1_000, event: 1_500, window: 1_005, start: 1_500 }],
  ['the same stamp twice: that stamp', { now: 100_000, event: 40_000, window: 40_000, start: 40_000 }],
]

describeHostCompile('wifi_quiet_start(): the newer of the event stamp and the window, by age (CR13-2)', () => {
  const binary = hostDriver()

  it.each(QUIET_CASES)('%s', (_name, c) => {
    expect(runDriver(binary(), ['quiet', String(c.now), String(c.event), String(c.window)])).toEqual([c.start])
  })
})

describeHostCompile('wifi_supervise_step(): one supervision pass over the quiet window (CR13-2)', () => {
  const binary = hostDriver()

  const requestsOf = (timeline: Timeline): number[] => {
    const end = timeline.durationMs + 10
    const [joinFrom, joinTo] = timeline.joining ?? [-1, -1]
    const [addressFrom, addressTo] = timeline.address ?? [-1, -1]
    return runDriver(binary(), [
      'timeline',
      String(timeline.durationMs),
      String(joinFrom),
      String(joinTo < 0 ? end : joinTo),
      String(addressFrom),
      String(addressTo < 0 ? end : addressTo),
      ...timeline.events.map((event) => (typeof event === 'number' ? String(event) : `${event.stamp}/${event.seenAt}`)),
    ])
  }

  it('(a) asks for nothing during a 27 s join that associates at 20 s and gets its address at 27 s', () => {
    expect(
      requestsOf({
        durationMs: 600_000,
        joining: [20_000, 27_000],
        address: [27_000, -1],
        events: [0, 20_000, 27_000],
      }),
    ).toEqual([])
  })

  it('(b) asks for nothing during a 5 minute DHCP wait after associating at 10 s', () => {
    expect(
      requestsOf({
        durationMs: 400_000,
        joining: [10_000, 310_000],
        address: [310_000, -1],
        events: [0, 10_000, 310_000],
      }),
    ).toEqual([])
  })

  it('(c) asks for nothing while the driver retries, one disconnect event every 5 s for 10 minutes', () => {
    const events = Array.from({ length: 121 }, (_, index) => index * 5_000)
    expect(requestsOf({ durationMs: 600_000, events })).toEqual([])
  })

  it('(d) asks once 60 s after the last event of a lost station with a silent driver, then not again for 60 s', () => {
    expect(requestsOf({ durationMs: 150_000, address: [0, 30_000], events: [0, 30_000] })).toEqual([90_000, 150_000])
  })

  it('(e) asks for nothing in the pass that reads a disconnect stamp one tick ahead of now, nor for 60 s after', () => {
    expect(
      requestsOf({
        durationMs: 660_000,
        address: [0, 600_000],
        events: [0, { stamp: 600_001, seenAt: 600_000 }],
      }),
    ).toEqual([])
  })

  it('(f) is not due on an idle station with a 120 s old window when the event stamp is now', () => {
    const [due] = runDriver(binary(), ['step', '0', '0', '200000', '200000', '80000'])
    expect(due).toBe(0)
  })
})
