import { Duplex } from 'node:stream'

import { FakeClock, settle } from './fake-clock'

/** One block of bytes the tool wrote, with the virtual time of the write. */
export type Written = { atMs: number; bytes: Buffer }

/**
 * In-memory stand-in for a TCP socket or a serial port: the test pushes the master's bytes in and reads back what
 * the tool wrote, block by block, with the virtual time of each write.
 */
export class MemoryLink {
  readonly writes: Written[] = []
  readonly stream: Duplex
  private consumed = 0

  constructor(private readonly clock: FakeClock) {
    this.stream = new Duplex({
      read() {},
      write: (chunk: Buffer | string, _encoding, callback) => {
        this.writes.push({ atMs: this.clock.ms, bytes: Buffer.from(chunk) })
        callback()
      },
    })
  }

  /** Every byte the tool wrote since the link was opened. */
  all(): Buffer {
    return Buffer.concat(this.writes.map((write) => write.bytes))
  }

  /** The bytes written since the previous call to `take`. */
  take(): Buffer {
    const bytes = this.all()
    const fresh = bytes.subarray(this.consumed)
    this.consumed = bytes.length
    return Buffer.from(fresh)
  }

  /** Delivers the master's bytes to the tool, lets it react, moves virtual time by `advanceMs`, returns the answer. */
  async exchange(request: Buffer, advanceMs = 50): Promise<Buffer> {
    this.take()
    this.stream.push(request)
    await settle()
    await this.clock.advance(advanceMs)
    return this.take()
  }
}
