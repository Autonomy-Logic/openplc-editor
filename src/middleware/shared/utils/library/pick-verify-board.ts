// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Which installed board stands in for a core during library verification.
 *
 * A library targets a core, not a device — the same thing `library.properties`
 * `architectures` names — but arduino-cli needs an FQBN, so one board of that
 * core has to represent it.
 *
 * Shared because both sides need the same answer: the compiler module picks
 * the board to compile against, and Build Settings shows the author which one
 * that will be. Two implementations would drift and the screen would start
 * naming a board the build does not use.
 */

/**
 * The board a verification falls back on, and its core.
 *
 * The simulator is bundled, so it is the one board always installed — which
 * is what makes it the fallback when a target names no core, or names one
 * with nothing installed for it. Named here rather than at each use so the
 * compiler and the screen that reports its choice cannot drift apart if
 * `hals.json` ever renames it.
 */
export const SIMULATOR_BOARD = 'OpenPLC Simulator'
export const SIMULATOR_CORE = 'arduino:avr'

/** The slice of a board catalogue entry the choice depends on. */
export interface VerifyBoardCandidate {
  name: string
  core?: string
  compiler?: string
}

/**
 * The board that represents `core`, or null when none is installed.
 *
 * A real arduino-cli board wins over the in-process simulator — the simulator
 * is a faked ATmega and a poor stand-in for a core that has actual hardware
 * behind it. Ties break by name, so the choice is stable across runs and does
 * not depend on the order packages were installed.
 */
export function pickVerifyBoard(candidates: readonly VerifyBoardCandidate[], core: string): string | null {
  const matching = candidates
    .filter((candidate) => candidate.core === core)
    .sort((a, b) => {
      const realA = a.compiler === 'arduino-cli' ? 0 : 1
      const realB = b.compiler === 'arduino-cli' ? 0 : 1
      return realA - realB || a.name.localeCompare(b.name)
    })
  return matching[0]?.name ?? null
}
