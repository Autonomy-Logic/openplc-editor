import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SimulatorTimers } from '../../wasm-simulator-module'

interface FixtureLeaf {
  path: string
  arrayIdx: number
  elemIdx: number
  type: string
  size: number
}

interface FixtureLeaves {
  md5: string
  retainBlobSize: number
  leaves: FixtureLeaf[]
}

/** The simulator build of `simulator-project/`; see README.md for how to rebuild it. */
export const fixtureModule = (): Uint8Array => new Uint8Array(readFileSync(join(__dirname, 'simulator-fixture.wasm')))

const leaves: FixtureLeaves = JSON.parse(readFileSync(join(__dirname, 'simulator-fixture.leaves.json'), 'utf-8'))

export const FIXTURE_MD5 = leaves.md5

/** The packed debug address of a variable of the fixture, such as `INSTANCE0.COUNTER`. */
export function debugIndex(path: string): number {
  const leaf = leaves.leaves.find((candidate) => candidate.path === path)
  if (!leaf) throw new Error(`The fixture has no debug leaf '${path}'.`)
  return ((leaf.arrayIdx & 0xff) << 16) | (leaf.elemIdx & 0xffff)
}

/**
 * Timers on a virtual wall clock that jumps forward to each callback, so a simulation runs as fast as the host can
 * go while the simulator still sees its scans paced one period apart.
 */
export function virtualTimers(): SimulatorTimers & { elapsedMs: () => number } {
  let now = 0
  return {
    now: () => now,
    elapsedMs: () => now,
    schedule: (callback, delayMs) => {
      const handle = setImmediate(() => {
        now += delayMs
        callback()
      })
      return () => clearImmediate(handle)
    },
  }
}

/** Little-endian signed integer of `size` bytes at `offset`. */
export function readInt(data: Uint8Array, offset: number, size: number): number {
  let value = 0
  for (let n = size - 1; n >= 0; n--) value = value * 256 + data[offset + n]
  const sign = 2 ** (size * 8 - 1)
  return value >= sign ? value - sign * 2 : value
}
