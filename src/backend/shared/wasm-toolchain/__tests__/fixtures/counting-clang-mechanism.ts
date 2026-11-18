import type {
  ClangWorkerHandle,
  ClangWorkerJobMessage,
  ClangWorkerMechanism,
  WasmClangJob,
  WasmClangJobResult,
} from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

/** What a fake clang worker does with a job: answer it, or never answer. */
export type FakeClangAnswer = (
  job: WasmClangJob,
) => Promise<WasmClangJobResult | 'never'> | WasmClangJobResult | 'never'

/** How a fake clang worker ends when terminated: at once, with a promise the test settles, or with a `void` return. */
export type FakeClangExit = 'auto' | 'manual' | 'void'

/** An in-memory clang worker: counted alive from its spawn until its `terminate()` has settled. */
export class FakeClangWorker implements ClangWorkerHandle {
  posted: ClangWorkerJobMessage[] = []
  answered = 0
  terminateCalls = 0
  exited = false
  private exitPromise: Promise<void> | null = null
  private settleExit: () => void = () => undefined
  private readonly messageListeners: Array<(raw: unknown) => void> = []
  private readonly failureListeners: Array<(reason: string) => void> = []

  constructor(private readonly mechanism: CountingClangMechanism) {}

  post(message: ClangWorkerJobMessage): void {
    this.posted.push(message)
    const answer = this.mechanism.answer
    if (!answer) return
    void Promise.resolve(answer({ argv: message.argv, tree: message.tree })).then((result) => {
      if (result === 'never' || this.exited) return
      this.reply(message.id, result)
    })
  }

  onMessage(listener: (raw: unknown) => void): void {
    this.messageListeners.push(listener)
  }

  onFailure(listener: (reason: string) => void): void {
    this.failureListeners.push(listener)
  }

  terminate(): Promise<void> | void {
    this.terminateCalls++
    const mode = this.mechanism.exitMode
    if (mode === 'void') {
      this.exited = true
      return
    }
    if (!this.exitPromise) {
      this.exitPromise = new Promise<void>((resolve) => {
        this.settleExit = () => {
          this.exited = true
          resolve()
        }
      })
      if (mode === 'auto') void Promise.resolve().then(() => this.settleExit())
    }
    return this.exitPromise
  }

  /** Settles a pending `terminate()`: the worker has exited. */
  exit(): void {
    this.settleExit()
  }

  /** Sends the worker's reply to a job. */
  reply(id: number, result: WasmClangJobResult): void {
    this.answered++
    this.send({ type: 'result', id, result })
  }

  /** Answers the oldest job not answered yet with a successful, empty result. */
  answerNext(exitCode = 0): void {
    const message = this.posted[this.answered]
    if (message) this.reply(message.id, { exitCode, stderr: '', stdout: '', tree: {} })
  }

  send(raw: unknown): void {
    for (const listener of this.messageListeners) listener(raw)
  }

  fail(reason: string): void {
    for (const listener of this.failureListeners) listener(reason)
  }
}

/**
 * In-memory clang worker mechanism that counts the workers it started and those that have exited. `maxAlive` is the
 * most workers alive at once; a worker is alive from `spawn()` until its `terminate()` has settled.
 */
export class CountingClangMechanism implements ClangWorkerMechanism {
  workers: FakeClangWorker[] = []
  loads = 0
  maxAlive = 0
  loadError: Error | null = null
  autoReady = true
  exitMode: FakeClangExit = 'auto'
  answer: FakeClangAnswer | null = null
  holdLoads = false
  /** The error `spawn()` throws, starting no worker; `null` lets it start one. */
  spawnError: Error | null = null
  /** Every `spawn()` call, the throwing ones included. */
  spawnAttempts = 0
  /** Every `discard()` call. */
  discards = 0
  /** The error `discard()` fails with; `null` lets it resolve. */
  discardError: Error | null = null
  /** Whether `discard()` throws `discardError` at once instead of returning a rejected promise. */
  discardThrows = false
  /** Whether `discard()` waits for `settleDiscards()` before it settles. */
  holdDiscards = false
  /** What `availableMemoryBytes()` reports; undefined as on a platform that cannot tell. */
  memory: number | undefined = undefined
  /** What `cores()` reports. */
  coreCount: number | undefined = undefined
  private readonly heldLoads: Array<() => void> = []
  private readonly heldDiscards: Array<() => void> = []

  get started(): number {
    return this.workers.length
  }

  get exited(): number {
    return this.workers.filter((worker) => worker.exited).length
  }

  get alive(): number {
    return this.started - this.exited
  }

  load(): Promise<void> {
    this.loads++
    if (this.holdLoads) {
      return new Promise<void>((resolve, reject) => {
        this.heldLoads.push(() => (this.loadError ? reject(this.loadError) : resolve()))
      })
    }
    return this.loadError ? Promise.reject(this.loadError) : Promise.resolve()
  }

  /** Settles every load held while `holdLoads` was set: rejects with `loadError` when set, resolves otherwise. */
  settleLoads(): void {
    for (const settle of this.heldLoads.splice(0)) settle()
  }

  /** Deletes the stored files: counts the call, then settles as `discardError`, `discardThrows` and `holdDiscards` say. */
  discard(): Promise<void> {
    this.discards++
    if (this.discardThrows && this.discardError) throw this.discardError
    if (this.holdDiscards) {
      return new Promise<void>((resolve, reject) => {
        this.heldDiscards.push(() => (this.discardError ? reject(this.discardError) : resolve()))
      })
    }
    return this.discardError ? Promise.reject(this.discardError) : Promise.resolve()
  }

  /** Settles every discard held while `holdDiscards` was set: rejects with `discardError` when set, resolves otherwise. */
  settleDiscards(): void {
    for (const settle of this.heldDiscards.splice(0)) settle()
  }

  availableMemoryBytes(): number | undefined {
    return this.memory
  }

  cores(): number | undefined {
    return this.coreCount
  }

  spawn(): ClangWorkerHandle {
    this.spawnAttempts++
    if (this.spawnError) throw this.spawnError
    const worker = new FakeClangWorker(this)
    this.workers.push(worker)
    this.maxAlive = Math.max(this.maxAlive, this.alive)
    if (this.autoReady) void Promise.resolve().then(() => worker.send({ type: 'ready' }))
    return worker
  }
}

/** The same mechanism with no `discard`, as the desktop and the CLI have. */
export function withoutDiscard(mechanism: CountingClangMechanism): ClangWorkerMechanism {
  return { load: () => mechanism.load(), spawn: () => mechanism.spawn() }
}

/** Lets pending promise callbacks run, without timers, so the test works under fake timers too. */
export async function flushMicrotasks(rounds = 50): Promise<void> {
  for (let round = 0; round < rounds; round++) await Promise.resolve()
}
