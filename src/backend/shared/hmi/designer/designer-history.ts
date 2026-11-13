/**
 * Undo and redo of a screen or widget block across the designer and the code view: both change the same source, so a
 * step is a source snapshot. Steps of one kind made close together (typing, dragging a value) merge into one.
 */

export interface HistoryMerge {
  /** Steps with the same key merge while each comes within `windowMs` of the previous one. */
  key: string
  at: number
  windowMs?: number
}

export const HISTORY_LIMIT = 200
const MERGE_WINDOW_MS = 1000

export class SourceHistory {
  private past: string[] = []
  private future: string[] = []
  private lastMerge: { key: string; at: number } | null = null

  constructor(
    private present: string,
    private readonly limit = HISTORY_LIMIT,
  ) {}

  get current(): string {
    return this.present
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Records the source after an edit; a source equal to the current one records nothing. */
  record(source: string, merge?: HistoryMerge): void {
    if (source === this.present) return
    const merging =
      merge !== undefined &&
      this.lastMerge !== null &&
      this.lastMerge.key === merge.key &&
      merge.at - this.lastMerge.at <= (merge.windowMs ?? MERGE_WINDOW_MS) &&
      this.past.length > 0
    if (!merging) {
      this.past.push(this.present)
      if (this.past.length > this.limit) this.past.shift()
    }
    this.present = source
    this.future = []
    this.lastMerge = merge ? { key: merge.key, at: merge.at } : null
  }

  /** The source before the last step, now current; null when there is none. */
  undo(): string | null {
    const previous = this.past.pop()
    if (previous === undefined) return null
    this.future.push(this.present)
    this.present = previous
    this.lastMerge = null
    return previous
  }

  /** The source of the step undone last, now current; null when there is none. */
  redo(): string | null {
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(this.present)
    this.present = next
    this.lastMerge = null
    return next
  }
}
