import { setImmediate as nextImmediate } from 'node:timers/promises'

type Timer = { id: number; dueMs: number; callback: () => void }

/** Lets pending I/O callbacks, promises and immediates of the code under test run. */
export async function settle(rounds = 5): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await nextImmediate()
  }
}

/**
 * Virtual clock injected into `runSlave`. Time moves only through `advance`; a timer of 0 ms waits 1 ms, as Node's
 * own `setTimeout` does, so a loop that yields through the clock still moves time forward.
 */
export class FakeClock {
  private nowMs = 0
  private nextId = 1
  private timers: Timer[] = []

  nowUs = (): number => Math.round(this.nowMs * 1000)

  setTimeout = (callback: () => void, ms: number): number => {
    const id = this.nextId
    this.nextId += 1
    this.timers.push({ id, dueMs: this.nowMs + Math.max(1, ms), callback })
    return id
  }

  clearTimeout = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle)
  }

  /** Current virtual time in milliseconds. */
  get ms(): number {
    return this.nowMs
  }

  /** Moves virtual time forward by `ms`, firing every due timer in order and settling after each one. */
  async advance(ms: number): Promise<void> {
    const target = this.nowMs + ms
    await settle()
    for (;;) {
      const due = this.timers.filter((timer) => timer.dueMs <= target).sort((a, b) => a.dueMs - b.dueMs || a.id - b.id)
      const next = due[0]
      if (!next) {
        break
      }
      this.timers = this.timers.filter((timer) => timer.id !== next.id)
      this.nowMs = next.dueMs
      next.callback()
      await settle()
    }
    this.nowMs = target
    await settle()
  }
}
