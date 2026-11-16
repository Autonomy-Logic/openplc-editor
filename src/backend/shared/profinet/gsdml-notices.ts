import type { GsdmlNotice } from '@root/middleware/shared/ports/gsdml-types'

/** The most notices one catalog keeps; further distinct notices are counted in one `notices-truncated` notice. */
export const GSDML_MAX_NOTICES = 1_000

/** Collects the notices of one parse: deduplicated, capped at {@link GSDML_MAX_NOTICES}, never printed. */
export class GsdmlNoticeLog {
  private readonly seen = new Set<string>()
  private readonly kept: GsdmlNotice[] = []
  private dropped = 0

  /** Records a notice unless an identical one was already recorded. */
  add(notice: GsdmlNotice): void {
    const key = JSON.stringify([notice.kind, notice.message, notice.elementId ?? null, notice.detail ?? null])
    if (this.seen.has(key)) return
    this.seen.add(key)
    if (this.kept.length < GSDML_MAX_NOTICES) this.kept.push(notice)
    else this.dropped += 1
  }

  /** The kept notices, followed by one `notices-truncated` notice when some were dropped. */
  toArray(): GsdmlNotice[] {
    if (this.dropped === 0) return [...this.kept]
    return [
      ...this.kept,
      {
        kind: 'notices-truncated',
        message: `${this.dropped} further notices were dropped after the first ${GSDML_MAX_NOTICES}.`,
        detail: String(this.dropped),
      },
    ]
  }
}

/** A notice with the optional element ID and detail set only when given. */
export function gsdmlNotice(
  kind: GsdmlNotice['kind'],
  message: string,
  elementId?: string,
  detail?: string,
): GsdmlNotice {
  return {
    kind,
    message,
    ...(elementId === undefined ? {} : { elementId }),
    ...(detail === undefined ? {} : { detail }),
  }
}
