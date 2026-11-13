/**
 * How many Python interpreters one simulator run may keep alive: as many as fit in half of the machine's memory, so a
 * project with many Python block instances cannot exhaust it. Costs are measured with numpy loaded, rounded up.
 */

const MiB = 1024 * 1024

/** What the first interpreter adds on top of the loaded runtime (measured about 230 MB with numpy). */
export const PYTHON_FIRST_INTERPRETER_BYTES = 256 * MiB

/** What each further interpreter adds (measured about 105 MB with numpy). */
export const PYTHON_INTERPRETER_BYTES = 128 * MiB

/** The memory assumed when the platform reports none (Safari and Firefox expose no figure). */
export const ASSUMED_TOTAL_MEMORY_BYTES = 8 * 1024 * MiB

/** The most interpreters a run may keep alive given `totalMemoryBytes` (`null` when unknown); always at least one. */
export function maxPythonInterpreters(totalMemoryBytes: number | null): number {
  const total =
    totalMemoryBytes !== null && Number.isFinite(totalMemoryBytes) && totalMemoryBytes > 0
      ? totalMemoryBytes
      : ASSUMED_TOTAL_MEMORY_BYTES
  const budget = total / 2
  return Math.max(1, 1 + Math.floor((budget - PYTHON_FIRST_INTERPRETER_BYTES) / PYTHON_INTERPRETER_BYTES))
}
