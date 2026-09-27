import type { RtosBackend, RtosTargetProfile } from './types'

/**
 * What each OS backend gives RTOS mode. The tick, the priority band and the
 * room for tasks are the firmware's (plc_os.h, plc_rtos.h), not a manifest's.
 */
const BACKENDS: Readonly<Record<RtosBackend, Omit<RtosTargetProfile, 'backend'>>> = {
  // FreeRTOS under ESP-IDF, 1 kHz (CONFIG_FREERTOS_HZ=1000 on every chip).
  'freertos-esp32': { tickNs: 1_000_000, workLevels: 8, maxTasks: 8, threads: 'native' },
  // The STM32duino FreeRTOS library, 1 kHz, 7 priorities.
  'freertos-stm32': {
    tickNs: 1_000_000,
    workLevels: 3,
    maxTasks: 4,
    threads: 'platform',
    library: 'STM32duino FreeRTOS',
    ownDispatcher: true,
  },
  // FreeRTOS SMP from arduino-pico, 1 kHz, 8 priorities, both cores; every RP2040
  // and RP2350 (ARM and RISC-V). Selected with the core's Operating System menu.
  'freertos-rp2040': {
    tickNs: 1_000_000,
    workLevels: 4,
    maxTasks: 8,
    threads: 'platform',
    boardOptions: { os: 'freertos' },
  },
  // The Renesas core's Arduino_FreeRTOS (Uno R4), 1 kHz. Its heap holds the
  // dispatcher, the service task and one 2 KB task. It ships with mutexes off,
  // 5 priorities, no time slicing and an 8 KB heap, so the build sets them.
  'freertos-renesas': {
    tickNs: 1_000_000,
    workLevels: 3,
    maxTasks: 1,
    threads: 'platform',
    ownDispatcher: true,
    fixedHeap: true,
    defines: [
      'configUSE_MUTEXES=1',
      'configUSE_RECURSIVE_MUTEXES=1',
      'configMAX_PRIORITIES=8',
      'configUSE_TIME_SLICING=1',
      // 32 KB less the core's 1 KB stack, its 8 KB heap and the firmware's own
      // variables, with the Uno R4 WiFi's radio.
      'configTOTAL_HEAP_SIZE=0x2C00',
      'INCLUDE_uxTaskGetStackHighWaterMark=1',
    ],
  },
  // FreeRTOS_SAMD21 (Zero, MKR, Nano 33 IoT), 1 kHz. Its fixed 14 KB heap holds
  // the dispatcher, the service task and two 2 KB tasks.
  'freertos-samd': {
    tickNs: 1_000_000,
    workLevels: 3,
    maxTasks: 2,
    threads: 'platform',
    library: 'FreeRTOS_SAMD21',
    ownDispatcher: true,
    fixedHeap: true,
  },
  // Mbed OS's RTX kernel, fixed at 1 kHz (mbed_rtx_conf.h).
  'mbed-rtx': { tickNs: 1_000_000, workLevels: 6, maxTasks: 8, threads: 'platform' },
  // Zephyr under the Arduino Zephyr core, 10 kHz (CONFIG_SYS_CLOCK_TICKS_PER_SEC)
  // on the boards listed for it below.
  zephyr: { tickNs: 100_000, workLevels: 8, maxTasks: 8, threads: 'platform' },
}

/**
 * Which Arduino cores run an RTOS the firmware has a backend for.
 *
 * Keyed on the core (`vendor:architecture`), because that is what decides the
 * RTOS: every ESP32 variant runs FreeRTOS, every Mbed board RTX, and so on,
 * whoever made the board.
 */
interface CoreRtos {
  backend: RtosBackend
  /** Board ids (the FQBN's third part) of the core too small for RTOS mode. */
  excludedBoards?: readonly string[]
  /** Parts too small for RTOS mode on any board id, matched against the FQBN's `pnum` option. */
  excludedParts?: RegExp
  /** The only board ids of the core RTOS mode is known to fit (the rest have none). */
  onlyBoards?: readonly string[]
}

const RTOS_BY_CORE: Readonly<Record<string, CoreRtos>> = {
  'esp32:esp32': { backend: 'freertos-esp32' },
  // Arduino's own ESP32 core (ESP-IDF 4.4): the same FreeRTOS.
  'arduino:esp32': { backend: 'freertos-esp32' },
  'arduino:mbed_nano': { backend: 'mbed-rtx' },
  'arduino:mbed_giga': { backend: 'mbed-rtx' },
  // The boards whose tick is the backend's (10 kHz): the core's others tick at
  // 32768 Hz, which the firmware's tick check would refuse.
  'arduino:zephyr': { backend: 'zephyr', onlyBoards: ['unoq', 'ventunoq'] },
  // arduino-pico: Pico, Pico W, Pico 2, Pico 2 W, in ARM and RISC-V builds.
  'rp2040:rp2040': { backend: 'freertos-rp2040' },
  // The F1 and the Cortex-M0/M0+ families, by generic board or by part name: most
  // of their parts lack the RAM, and on a Cortex-M0 FreeRTOS masks every interrupt
  // from the first allocation until its scheduler starts.
  'STMicroelectronics:stm32': {
    backend: 'freertos-stm32',
    excludedBoards: ['GenF0', 'GenF1', 'GenL0', 'GenG0', 'GenC0', 'GenU0', 'GenWB0', 'GenWL3'],
    excludedParts: /(?:^|_|STM32)(?:F0|F1|L0|G0|C0|U0|WB0|WL3)[0-9A-Z]{2}/i,
  },
  'arduino:renesas_uno': { backend: 'freertos-renesas' },
  'arduino:samd': { backend: 'freertos-samd' },
}

const KNOWN_BACKENDS: ReadonlySet<string> = new Set<string>(Object.keys(BACKENDS))

function isRtosBackend(value: unknown): value is RtosBackend {
  return typeof value === 'string' && KNOWN_BACKENDS.has(value)
}

/** A board option of a fully-qualified board name: `pnum` in `STMicroelectronics:stm32:GenF4:pnum=BLACKPILL_F411CE`. */
function fqbnOption(fqbn: string, key: string): string | undefined {
  const [, , , ...rest] = fqbn.split(':')
  const pair = rest
    .join(',')
    .split(',')
    .find((entry) => entry.startsWith(`${key}=`))
  return pair?.slice(key.length + 1)
}

/**
 * `fqbn` with `options` set among its board options, replacing any the board
 * already sets under the same key: `rp2040:rp2040:rpipico` with `{ os: 'freertos' }`
 * is `rp2040:rp2040:rpipico:os=freertos`. arduino-cli takes the options as one
 * comma-separated fourth part; options already joined by a colon are read too.
 */
export function withFqbnOptions(fqbn: string, options: Readonly<Record<string, string>> | undefined): string {
  const added = Object.entries(options ?? {})
  if (added.length === 0) return fqbn
  const [vendor, architecture, board, ...rest] = fqbn.split(':')
  if (!vendor || !architecture || !board) return fqbn
  const merged = new Map<string, string>()
  for (const pair of rest.join(',').split(',')) {
    const eq = pair.indexOf('=')
    if (eq > 0) merged.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  for (const [key, value] of added) merged.set(key, value)
  const text = [...merged].map(([key, value]) => `${key}=${value}`).join(',')
  return `${vendor}:${architecture}:${board}:${text}`
}

/**
 * The core of a fully-qualified board name: `esp32:esp32:esp32s3:CDCOnBoot=cdc`
 * is on `esp32:esp32`. Anything without both halves has no core.
 */
export function coreFromFqbn(fqbn: string | undefined): string | undefined {
  if (!fqbn) return undefined
  const [vendor, architecture] = fqbn.split(':')
  return vendor && architecture ? `${vendor}:${architecture}` : undefined
}

/**
 * The RTOS profile a board resolves to, or `undefined` when it has none.
 *
 * The core table is the default. A package's `false` turns a supported core off
 * for its board, and a declared `backend` turns RTOS mode on for a core the table
 * does not list, but only a backend the firmware implements. The tick, priority
 * band and room for tasks are always the backend's. `fqbn` keeps a core's
 * too-small boards and parts out.
 */
export function resolveRtosProfile(
  core: string | undefined,
  declared: unknown,
  fqbn = '',
): RtosTargetProfile | undefined {
  if (declared === false) return undefined

  const fromTable = core ? RTOS_BY_CORE[core] : undefined
  const boardId = fqbn.split(':')[2] ?? ''
  const part = fqbnOption(fqbn, 'pnum') ?? ''
  const excluded =
    fromTable?.excludedBoards?.includes(boardId) === true ||
    fromTable?.excludedParts?.test(part) === true ||
    (fromTable?.onlyBoards !== undefined && !fromTable.onlyBoards.includes(boardId))
  const block = typeof declared === 'object' && declared !== null ? declared : {}
  const declaredBackend = 'backend' in block ? block.backend : undefined

  // On a listed core a declaration naming another backend is ignored, and one
  // naming the core's own turns RTOS mode on for a board the table left out. On
  // an unlisted core a declared backend is the package's word.
  const declaredValid = isRtosBackend(declaredBackend) && (!fromTable || fromTable.backend === declaredBackend)
  const backend = declaredValid ? declaredBackend : excluded ? undefined : fromTable?.backend
  if (!backend) return undefined
  return { backend, ...BACKENDS[backend] }
}
