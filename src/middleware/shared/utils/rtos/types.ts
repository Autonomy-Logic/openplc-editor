/**
 * RTOS mode: the Baremetal firmware runs each IEC task on a thread of its own on
 * the RTOS the board's Arduino core ships, released on a base tick that skips an
 * overrunning task instead of queueing it, with the services on tasks of their own.
 *
 * Support is a property of the Arduino core, not of a board. A package may refuse
 * it, or raise it on a core the table does not list, through `capabilities.rtos`.
 *
 * Byte-identical between openplc-editor and openplc-web.
 */

/**
 * The OS shim backend the firmware compiles (`plc_os.cpp`). One per RTOS and
 * core family, because each differs in priorities, stack units and timers.
 */
export type RtosBackend =
  | 'freertos-esp32'
  | 'freertos-stm32'
  | 'freertos-rp2040'
  | 'freertos-renesas'
  | 'freertos-samd'
  | 'mbed-rtx'
  | 'zephyr'

/**
 * What a package may write under `capabilities.rtos`: `false` refuses RTOS mode
 * for the board, and `{ backend }` raises it on a core the table does not list.
 * The manifest is external data, so it is checked before it is trusted.
 */
export type DeclaredRtos = { backend?: RtosBackend } | false

export interface RtosTargetProfile {
  backend: RtosBackend
  /**
   * The RTOS tick, in nanoseconds. A task can only be released on a tick, so a
   * task interval that is not a whole number of ticks cannot be honoured and the
   * build refuses it rather than silently rounding the period.
   */
  tickNs: number
  /**
   * Native priority levels the backend sets aside for IEC tasks. IEC PRIORITY
   * 0 takes the top one and each lower distinct priority the next, so a project
   * with more distinct priorities than levels cannot keep their order.
   */
  workLevels: number
  /** IEC tasks the board has room for, each a thread with a stack of its own. */
  maxTasks: number
  /**
   * How the threaded STruC++ runtime gets its locks and per-thread IEC time.
   * `native`: the toolchain's std::mutex and thread_local (ESP32). `platform`:
   * the RTOS, through plc_os.cpp, on toolchains without them (the ARM cores);
   * this needs a STruC++ runtime with that hook (STRUCPP_PLATFORM_THREADS), and
   * with an older one every IEC task runs on one PLC thread.
   */
  threads: 'native' | 'platform'
  /** An Arduino library the backend needs installed (the STM32 FreeRTOS port). */
  library?: string
  /**
   * Board options (the FQBN's fourth part) the RTOS needs selected, over the
   * board's own: arduino-pico builds FreeRTOS only with `os=freertos`.
   */
  boardOptions?: Readonly<Record<string, string>>
  /**
   * Preprocessor definitions (`NAME=value`) the RTOS needs in every file the
   * build compiles, its own included: the Uno R4's FreeRTOS ships with mutexes
   * off and an 8 KB heap, both only settable this way.
   */
  defines?: readonly string[]
  /**
   * The dispatcher is a task of its own (plc_os.h's PLC_OS_OWN_DISPATCHER): the
   * RTOS is not running under setup(), and its own idle and timer tasks come
   * out of the same memory as RTOS mode's.
   */
  ownDispatcher?: boolean
  /**
   * Every task and stack comes from a fixed RTOS heap, which the firmware
   * checks against its tasks when it compiles; the editor's RAM check leaves
   * such a board alone. Otherwise stacks come from what the link leaves free.
   */
  fixedHeap?: boolean
}

/** The user's choice for one board, kept in `vendorScreenData.rtos`. */
export interface RtosSettings {
  enabled: boolean
  /** The user set the switch, rather than leaving the default. A project RTOS
   *  mode cannot build then fails; on the default it builds the single loop. */
  chosen: boolean
}

/**
 * A run of one debug array's entries that belong to one task's programs, so the
 * firmware can lock only that task while the debugger reads or writes them.
 */
export interface RtosDebugOwnerRange {
  arr: number
  first: number
  last: number
  task: string
}

/** A task whose interval RTOS mode cannot schedule. */
export interface RtosIntervalProblem {
  task: string
  interval: string
  reason: string
}
