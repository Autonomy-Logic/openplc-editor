import { raiseRecordedMtime, shouldReportExternalChange } from '@root/backend/shared/utils/file-watch/own-write'

/** The platform mechanisms the registry drives. */
export interface FileWatchMechanisms {
  watchFile(path: string, onChange: (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void): void
  unwatchFile(path: string): void
  stat(path: string): Promise<{ mtimeMs: number }>
  statSync(path: string): { mtimeMs: number }
  /** One key per file, whatever separator or case the path arrives in. */
  canonicalPath(path: string): string
  emitExternalChange(rendererPath: string): void
}

interface WatchEntry {
  /** The path string the renderer gave, which is what an event carries back. */
  rendererPath: string
  recordedMtimeMs: number
}

/** The watched files of the open project, and the modification time recorded for each. */
export class FileWatchRegistry {
  private readonly entries = new Map<string, WatchEntry>()

  constructor(private readonly mechanisms: FileWatchMechanisms) {}

  async start(rendererPath: string): Promise<{ success: boolean; error?: string }> {
    const key = this.mechanisms.canonicalPath(rendererPath)
    if (this.entries.has(key)) return { success: true }

    let initialMtimeMs: number
    try {
      initialMtimeMs = (await this.mechanisms.stat(rendererPath)).mtimeMs
    } catch (error) {
      return { success: false, error: `Failed to stat file: ${messageOf(error)}` }
    }

    try {
      this.mechanisms.watchFile(rendererPath, (curr, prev) => this.onPoll(key, curr, prev))
    } catch (error) {
      return { success: false, error: `Failed to watch file: ${messageOf(error)}` }
    }

    this.entries.set(key, { rendererPath, recordedMtimeMs: initialMtimeMs })
    return { success: true }
  }

  stop(rendererPath: string): void {
    const key = this.mechanisms.canonicalPath(rendererPath)
    const entry = this.entries.get(key)
    if (!entry) return
    this.mechanisms.unwatchFile(entry.rendererPath)
    this.entries.delete(key)
  }

  stopAll(): void {
    for (const entry of this.entries.values()) {
      this.mechanisms.unwatchFile(entry.rendererPath)
    }
    this.entries.clear()
  }

  isWatching(rendererPath: string): boolean {
    return this.entries.has(this.mechanisms.canonicalPath(rendererPath))
  }

  /** Records the modification time the app's own write left, so the next poll does not report it. */
  recordOwnWrite(absolutePath: string): void {
    const entry = this.entries.get(this.mechanisms.canonicalPath(absolutePath))
    if (!entry) return
    try {
      entry.recordedMtimeMs = raiseRecordedMtime(
        entry.recordedMtimeMs,
        this.mechanisms.statSync(entry.rendererPath).mtimeMs,
      )
    } catch {
      /* The file may have been removed between the write and this read. */
    }
  }

  private onPoll(key: string, curr: { mtimeMs: number }, prev: { mtimeMs: number }): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (
      !shouldReportExternalChange({
        prevMtimeMs: prev.mtimeMs,
        currMtimeMs: curr.mtimeMs,
        recordedMtimeMs: entry.recordedMtimeMs,
      })
    ) {
      return
    }
    entry.recordedMtimeMs = curr.mtimeMs
    this.mechanisms.emitExternalChange(entry.rendererPath)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
