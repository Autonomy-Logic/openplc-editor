import type { ElectronApplication } from '@playwright/test'

/** The worker scripts the main process starts, as the build names them. */
export type WorkerScript = 'clang-worker.js' | 'python-worker.js' | 'simulator-worker.js'

export interface WorkerThreads {
  /** Script of each worker thread alive now. */
  live: string[]
  /** Script of each worker thread seen since tracking began, in start order; those alive then come first. */
  started: string[]
  /** The most worker threads of each script alive at one moment since tracking began. */
  maxLive: Record<string, number>
}

const STATE_KEY = '__openplcE2eWorkerThreads'

/**
 * Starts tracking the Electron main process's worker threads by script, through the main process's own inspector
 * (`NodeWorker` domain), which reports every worker thread when it starts and when it has exited; the app needs no
 * test hook. Threads already running are reported first, so `live` right after this call tells which threads the app
 * started before it.
 */
export async function trackWorkerThreads(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    (_electron, key) =>
      new Promise<void>((resolve, reject) => {
        const getBuiltin: unknown = Reflect.get(process, 'getBuiltinModule')
        if (typeof getBuiltin !== 'function') {
          reject(new Error('process.getBuiltinModule is not available in the main process.'))
          return
        }
        const inspector: typeof import('node:inspector') = getBuiltin.call(process, 'node:inspector')
        const started: string[] = []
        const maxLive: Record<string, number> = {}
        const state = { live: new Map<string, string>(), started, maxLive }
        const scriptOf = (url: string): string => url.slice(url.lastIndexOf('/') + 1)
        const session = new inspector.Session()
        session.connect()
        session.on('NodeWorker.attachedToWorker', (message) => {
          const script = scriptOf(message.params.workerInfo.url)
          state.live.set(message.params.sessionId, script)
          state.started.push(script)
          const alive = [...state.live.values()].filter((s) => s === script).length
          state.maxLive[script] = Math.max(state.maxLive[script] ?? 0, alive)
        })
        session.on('NodeWorker.detachedFromWorker', (message) => {
          state.live.delete(message.params.sessionId)
        })
        Reflect.set(globalThis, key, state)
        session.post('NodeWorker.enable', { waitForDebuggerOnStart: false }, (error) =>
          error ? reject(new Error(error.message)) : resolve(),
        )
      }),
    STATE_KEY,
  )
}

/** The worker threads as tracked since `trackWorkerThreads`. */
export function workerThreads(app: ElectronApplication): Promise<WorkerThreads> {
  return app.evaluate((_electron, key) => {
    const state: unknown = Reflect.get(globalThis, key)
    if (typeof state !== 'object' || state === null) throw new Error('Worker threads are not tracked.')
    const live: unknown = Reflect.get(state, 'live')
    const started: unknown = Reflect.get(state, 'started')
    const maxLive: unknown = Reflect.get(state, 'maxLive')
    return {
      live: live instanceof Map ? [...live.values()].map(String) : [],
      started: Array.isArray(started) ? started.map(String) : [],
      maxLive: Object.fromEntries(
        Object.entries(typeof maxLive === 'object' && maxLive !== null ? maxLive : {}).map(([s, n]) => [s, Number(n)]),
      ),
    }
  }, STATE_KEY)
}

/** How many entries of `scripts` are `script`. */
export const countOf = (scripts: string[], script: WorkerScript): number => scripts.filter((s) => s === script).length
