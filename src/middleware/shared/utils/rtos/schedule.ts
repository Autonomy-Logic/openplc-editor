import { findIntervalsOffTick, type RtosTaskLike } from './intervals'
import { countDistinctPriorities } from './tasks'
import type { RtosTargetProfile } from './types'

/**
 * Why RTOS mode cannot run these tasks on this board, or undefined when it can.
 * Each task takes a thread (and its stack) of its own and is released on the
 * RTOS tick, so its period must be a whole number of ticks, and each distinct
 * IEC priority takes a native level of its own, highest first.
 *
 * The build and the editor both ask this, so the screens say what the build
 * will do: on the default, a project with a problem builds the single loop.
 */
export function rtosScheduleProblem(
  tasks: readonly (RtosTaskLike & { priority: number })[],
  profile: RtosTargetProfile,
): string | undefined {
  if (tasks.length > profile.maxTasks) {
    return (
      `RTOS mode runs each task on a thread of its own, and this board has room for ${profile.maxTasks}; ` +
      `the project has ${tasks.length}. Put some programs in the same task.`
    )
  }
  const offTick = findIntervalsOffTick(tasks, profile.tickNs)
  if (offTick.length > 0) {
    const listed = offTick.map((problem) => `${problem.task} (${problem.interval}): ${problem.reason}`).join('; ')
    return `RTOS mode cannot schedule these tasks — ${listed}.`
  }
  const distinct = countDistinctPriorities(tasks)
  if (distinct > profile.workLevels) {
    return (
      `RTOS mode gives each distinct task priority a level of its own, and this board has ${profile.workLevels}; ` +
      `the project uses ${distinct}. Give some tasks the same priority.`
    )
  }
  return undefined
}

/** What a linker or arduino-cli prints when the firmware does not fit the board. */
const OUT_OF_MEMORY =
  /region `?[^\s'`]+'? overflowed|will not fit in region|section \S+ VMA \[[^\]]*\] overlaps section|Sketch too big|Not enough memory/i

/** A compiler quoting a source line (`  12 | code`, `     |  ^`): the user's text, not a verdict. */
const SOURCE_ECHO = /^\s*\d*\s*\|/

/**
 * The build output says the firmware is too big for the board's flash or RAM;
 * a project on RTOS mode's default then builds the single loop instead.
 * Takes the output a line or a chunk at a time, as it streams; a line quoting
 * the user's source is never taken for the linker's verdict.
 */
export function firmwareOutgrewBoard(output: string | readonly string[]): boolean {
  const chunks = typeof output === 'string' ? [output] : output
  return chunks.some((chunk) =>
    chunk.split(/\r?\n/).some((line) => !SOURCE_ECHO.test(line) && OUT_OF_MEMORY.test(line)),
  )
}

/** The files a project's own C/C++ code is compiled in. */
const PROJECT_CODE = /(^|[\\/])(c_blocks_code\.cpp|c_blocks\.h)$/
/** A compiler's error line: `path:line[:column]: [fatal ]error: ...`. */
const DIAGNOSTIC = /^(.+?):\d+(?::\d+)?:\s+(?:fatal\s+)?error:/

/**
 * An RTOS-mode build failed somewhere other than the project's own C/C++ code:
 * in RTOS mode's sources, the RTOS library, the threaded runtime, the core, or
 * the link. The single loop may well build then, where an error in a C/C++
 * block would fail it just the same. Read from the compiler's error lines (a
 * failed build reports its output as one message); a failure that names no
 * source file (a link error, a missing library) counts as RTOS mode's.
 */
export function rtosBuildFailureIsOurs(errors: ReadonlyArray<{ message: string; file?: string }>): boolean {
  const files: string[] = []
  for (const error of errors) {
    if (error.file) files.push(error.file)
    for (const line of error.message.split(/\r?\n/)) {
      const match = DIAGNOSTIC.exec(line.trim())
      if (match) files.push(match[1])
    }
  }
  if (files.length === 0) return true
  return files.some((file) => !PROJECT_CODE.test(file))
}

/** arduino-cli's summary after a link: the RAM the firmware's variables leave free. */
const RAM_LEFT = /leaving (-?\d+) bytes for local variables/

/** The free RAM a build's output reports, or undefined when this line does not say. */
export function ramLeftAfterLink(output: string): number | undefined {
  const match = RAM_LEFT.exec(output)
  return match ? Number(match[1]) : undefined
}

// What RTOS mode takes from the heap when it starts, mirroring the firmware
// (plc_rtos.h, plc_os.h, plc_os.cpp's PLC_OS_TASK_COST): each task's stack, a
// control block per task and per mutex, the process image's bookkeeping for each
// located variable, and on a board whose RTOS starts after setup() its own idle
// and timer tasks. The main stack's own share of the free RAM is kept back too.
const STACKS = { work: 16384, serviceA: 8192, serviceB: 16384, dispatcher: 8192 } as const
const TASK_OVERHEAD = 448
const MUTEX_BYTES = 96
/** A lock per serial port (plc_rtos.cpp's OPENPLC_RTOS_SERIAL_LOCKS), and one for their table. */
const SERIAL_LOCKS = 8 + 1
const RTOS_OWN_TASKS_BYTES = 2700
const MAIN_STACK_BYTES = 1024
/** The runtime's per-task tables, made when RTOS mode starts. */
const RUNTIME_BYTES = 256
/** A located variable's image binding and cell. */
const LOCATED_VARIABLE_BYTES = 32

export interface RtosRamNeedArgs {
  profile: RtosTargetProfile
  /** IEC task workers: one per task when threaded, else one. */
  workers: number
  /** An OPC-UA or S7 server is enabled (a second service task). */
  serviceB: boolean
  /** Shared globals that take a lock each (a threaded build on a `platform` backend). */
  lockedGlobals: number
  /** Located variables, each bound to a cell of the process image when RTOS mode starts. */
  locatedVariables: number
}

/**
 * About how much RAM RTOS mode's tasks take when the board starts, or undefined
 * where the firmware checks that itself (a fixed RTOS heap).
 */
export function rtosRamNeed({
  profile,
  workers,
  serviceB,
  lockedGlobals,
  locatedVariables,
}: RtosRamNeedArgs): number | undefined {
  if (profile.fixedHeap) return undefined
  const serviceBBytes = serviceB ? STACKS.serviceB : 0
  const dispatcherBytes = profile.ownDispatcher ? STACKS.dispatcher : 0
  const tasks = workers + 1 + (serviceB ? 1 : 0) + (profile.ownDispatcher ? 1 : 0)
  // Scan locks, the image and statistics locks, the four bus locks, the serial
  // port locks and the globals'.
  const mutexes = workers + 2 + 4 + SERIAL_LOCKS + lockedGlobals
  return (
    workers * STACKS.work +
    STACKS.serviceA +
    serviceBBytes +
    dispatcherBytes +
    tasks * TASK_OVERHEAD +
    mutexes * MUTEX_BYTES +
    locatedVariables * LOCATED_VARIABLE_BYTES +
    RUNTIME_BYTES +
    (profile.ownDispatcher ? RTOS_OWN_TASKS_BYTES : 0) +
    MAIN_STACK_BYTES
  )
}

const LOCATED_COUNT = /\bconstexpr\s+uint32_t\s+locatedVarsCount\s*=\s*(\d+)\s*;/

/**
 * How many located variables a program has, from the STruC++ header generated
 * for it (`generated.hpp`), or 0 when the header does not say.
 */
export function locatedVariableCount(generatedHeader: string): number {
  const match = LOCATED_COUNT.exec(generatedHeader)
  return match ? Number(match[1]) : 0
}

/**
 * Why RTOS mode's tasks will not fit the RAM this build leaves free, or
 * undefined when they will (or when it cannot be told). The link succeeds
 * either way, since the stacks are made at start-up: without this, a board too
 * small for them boots and stops in ERROR.
 */
export function rtosRamProblem(need: number | undefined, freeBytes: number | undefined): string | undefined {
  if (need === undefined || freeBytes === undefined || freeBytes >= need) return undefined
  const kb = (bytes: number): string => `${Math.max(0, Math.round(bytes / 1024))} KB`
  return `RTOS mode's tasks need about ${kb(need)} of RAM when the board starts, and this build leaves ${kb(freeBytes)} free.`
}
