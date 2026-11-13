import { runSlave } from '../../scenario'
import { FakeClock } from './fake-clock'
import { MemoryLink } from './memory-link'

/** A scenario running on an in-memory link with a virtual clock, and the events it logged. */
export type OpenSlave = {
  clock: FakeClock
  link: MemoryLink
  events: Array<Record<string, unknown>>
  stop: () => void
}

/** Starts `runSlave` for one scenario on an in-memory TCP connection or serial line, with the default groups. */
export function openSlave(scenario: string, transport: 'tcp' | 'rtu', row?: number): OpenSlave {
  const clock = new FakeClock()
  const link = new MemoryLink(clock)
  const events: Array<Record<string, unknown>> = []
  const slave = runSlave({
    scenario,
    row,
    transport,
    stream: link.stream,
    log: (event: Record<string, unknown>) => {
      events.push(event)
    },
    clock: { nowUs: clock.nowUs, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  })
  return { clock, link, events, stop: () => slave.stop() }
}
