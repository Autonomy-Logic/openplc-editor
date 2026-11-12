import type { FileWatchMechanisms } from '../../../../../middleware/shared/ports/file-watch-mechanisms'
import { canonicalWatchKey, FileWatchRegistry } from '../registry'

type PollCallback = (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void

interface Harness {
  registry: FileWatchRegistry
  mechanisms: FileWatchMechanisms
  /** Current modification time of each file on the fake disk. */
  mtimes: Map<string, number>
  /** The poll callback registered for each watched path. */
  polls: Map<string, PollCallback>
  watched: string[]
  unwatched: string[]
  emitted: string[]
  statFails: Set<string>
  /** Fires the watcher poll for a path, as `fs.watchFile` would. */
  poll(path: string, previousMtimeMs: number): void
}

/** Production folding on a Windows key, with the separator pass `path.resolve` runs there. */
const canonicalPath = (path: string) => canonicalWatchKey(path.replace(/\\/g, '/'), 'win32')

function harness(): Harness {
  const mtimes = new Map<string, number>()
  const polls = new Map<string, PollCallback>()
  const watched: string[] = []
  const unwatched: string[] = []
  const emitted: string[] = []
  const statFails = new Set<string>()

  const readMtime = (path: string) => {
    const key = canonicalPath(path)
    if (statFails.has(key)) throw new Error('stat failed')
    const mtimeMs = mtimes.get(key)
    if (mtimeMs === undefined) throw new Error(`no such file: ${path}`)
    return { mtimeMs }
  }

  const mechanisms: FileWatchMechanisms = {
    watchFile: (path, onChange) => {
      watched.push(path)
      polls.set(canonicalPath(path), onChange)
    },
    unwatchFile: (path) => {
      unwatched.push(path)
      polls.delete(canonicalPath(path))
    },
    stat: (path) => Promise.resolve(readMtime(path)),
    statSync: readMtime,
    canonicalPath,
    emitExternalChange: (rendererPath) => emitted.push(rendererPath),
  }

  return {
    registry: new FileWatchRegistry(mechanisms),
    mechanisms,
    mtimes,
    polls,
    watched,
    unwatched,
    emitted,
    statFails,
    poll(path, previousMtimeMs) {
      const callback = polls.get(canonicalPath(path))
      if (!callback) throw new Error(`not watched: ${path}`)
      callback({ mtimeMs: mtimes.get(canonicalPath(path)) ?? 0 }, { mtimeMs: previousMtimeMs })
    },
  }
}

const MAIN = '/proj/pous/programs/main.st'
const AUX = '/proj/pous/programs/aux.st'

/**
 * AS2: the editor's own write is suppressed, and the next write by another process is reported
 * exactly once, for the right file.
 */
describe.each([
  ['the file the editor wrote', MAIN],
  ['a file the editor did not write', AUX],
])('a real change to %s after the editor writes main.st', (_label, changedFile) => {
  it('emits nothing for the editor write and exactly one event for the other process', async () => {
    const h = harness()
    h.mtimes.set(canonicalPath(MAIN), 1000)
    h.mtimes.set(canonicalPath(AUX), 1000)
    await h.registry.start(MAIN)
    await h.registry.start(AUX)

    h.mtimes.set(canonicalPath(MAIN), 2000)
    h.registry.recordOwnWrite(MAIN)
    h.poll(MAIN, 1000)

    expect(h.emitted).toEqual([])

    h.mtimes.set(canonicalPath(changedFile), 3000)
    h.poll(changedFile, changedFile === MAIN ? 2000 : 1000)

    expect(h.emitted).toEqual([changedFile])
  })
})

describe('canonicalWatchKey', () => {
  it.each([
    ['win32', 'C:/Proj/Pous/Main.st', 'c:/proj/pous/main.st'],
    ['darwin', '/Users/J/Proj/Main.st', '/users/j/proj/main.st'],
  ])('folds case on %s, where one file answers to either spelling', (platform, resolvedPath, expected) => {
    expect(canonicalWatchKey(resolvedPath, platform)).toBe(expected)
  })

  it('keeps case on linux, where two spellings are two files', () => {
    expect(canonicalWatchKey('/home/j/Proj/Main.st', 'linux')).toBe('/home/j/Proj/Main.st')
  })
})

describe('FileWatchRegistry', () => {
  it('suppresses a write reported with Windows separators on a path watched with forward slashes', async () => {
    const h = harness()
    const rendererPath = 'C:/proj/pous/programs/main.st'
    h.mtimes.set(canonicalPath(rendererPath), 1000)
    await h.registry.start(rendererPath)

    h.mtimes.set(canonicalPath(rendererPath), 2000)
    h.registry.recordOwnWrite('C:\\proj\\pous\\programs\\main.st')
    h.poll(rendererPath, 1000)

    expect(h.emitted).toEqual([])
  })

  it("emits the renderer's own path string, not a canonical one", async () => {
    const h = harness()
    const rendererPath = 'C:/Proj/Pous/Programs/Main.st'
    h.mtimes.set(canonicalPath(rendererPath), 1000)
    await h.registry.start(rendererPath)

    h.mtimes.set(canonicalPath(rendererPath), 3000)
    h.poll(rendererPath, 1000)

    expect(h.emitted).toEqual([rendererPath])
  })

  it('watches a path once however many times it is started', async () => {
    const h = harness()
    h.mtimes.set(canonicalPath(MAIN), 1000)

    expect(await h.registry.start(MAIN)).toEqual({ success: true })
    expect(await h.registry.start(MAIN)).toEqual({ success: true })
    expect(h.watched).toEqual([MAIN])
  })

  it('reports a failed stat instead of watching', async () => {
    const h = harness()
    h.mtimes.set(canonicalPath(MAIN), 1000)
    h.statFails.add(canonicalPath(MAIN))

    const result = await h.registry.start(MAIN)

    expect(result.success).toBe(false)
    expect(result.error).toContain('stat failed')
    expect(h.watched).toEqual([])
  })

  it('unwatches on stop and stops watching the path', async () => {
    const h = harness()
    h.mtimes.set(canonicalPath(MAIN), 1000)
    await h.registry.start(MAIN)

    h.registry.stop(MAIN)

    expect(h.unwatched).toEqual([MAIN])
    expect(h.polls.size).toBe(0)
  })

  it('unwatches every path on stopAll', async () => {
    const h = harness()
    h.mtimes.set(canonicalPath(MAIN), 1000)
    h.mtimes.set(canonicalPath(AUX), 1000)
    await h.registry.start(MAIN)
    await h.registry.start(AUX)

    h.registry.stopAll()

    expect(h.unwatched).toEqual([MAIN, AUX])
    expect(h.polls.size).toBe(0)
  })

  it('does nothing when the written path is not watched', () => {
    const h = harness()
    h.mtimes.set(canonicalPath(MAIN), 2000)

    expect(() => h.registry.recordOwnWrite(MAIN)).not.toThrow()
    expect(h.emitted).toEqual([])
  })

  it('does nothing when the stat after the write fails', async () => {
    const h = harness()
    h.mtimes.set(canonicalPath(MAIN), 1000)
    await h.registry.start(MAIN)
    h.statFails.add(canonicalPath(MAIN))

    expect(() => h.registry.recordOwnWrite(MAIN)).not.toThrow()

    h.statFails.delete(canonicalPath(MAIN))
    h.mtimes.set(canonicalPath(MAIN), 2000)
    h.poll(MAIN, 1000)

    expect(h.emitted).toEqual([MAIN])
  })

  it('does not lower a recorded time when a later write lands older', async () => {
    const h = harness()
    h.mtimes.set(canonicalPath(MAIN), 1000)
    await h.registry.start(MAIN)

    h.mtimes.set(canonicalPath(MAIN), 3000)
    h.registry.recordOwnWrite(MAIN)
    h.mtimes.set(canonicalPath(MAIN), 2000)
    h.registry.recordOwnWrite(MAIN)
    h.mtimes.set(canonicalPath(MAIN), 3000)
    h.poll(MAIN, 1000)

    expect(h.emitted).toEqual([])
  })
})
