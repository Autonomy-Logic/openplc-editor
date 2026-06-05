import { diffLines } from 'diff'
import { v4 as uuidv4 } from 'uuid'

export type DiffHunkType = 'added' | 'removed' | 'modified'

export type DiffHunk = {
  id: string
  type: DiffHunkType
  /** Start line in the NEW body (1-based) */
  startLine: number
  /** End line in the NEW body (1-based, inclusive) */
  endLine: number
  /** The new lines (for added/modified) */
  newLines: string[]
  /** The old lines (for removed/modified) */
  oldLines: string[]
}

/**
 * Compute diff hunks between old and new code bodies.
 * Groups consecutive changes into hunks for review.
 */
export function computeHunks(oldBody: string, newBody: string): DiffHunk[] {
  const changes = diffLines(oldBody, newBody)
  const hunks: DiffHunk[] = []
  let newLineNum = 1

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    const lines = change.value.split('\n')
    // diffLines includes a trailing empty string from the final \n
    if (lines[lines.length - 1] === '') lines.pop()

    if (!change.added && !change.removed) {
      // Unchanged block — advance line counter
      newLineNum += lines.length
      continue
    }

    if (change.added) {
      // Check if the previous change was a removal (modification pattern)
      const prev = i > 0 ? changes[i - 1] : null
      if (prev && prev.removed) {
        // This is a modification — the previous removal + this addition form a pair
        // The removal was already processed, update the last hunk to be 'modified'
        const lastHunk = hunks[hunks.length - 1]
        if (lastHunk && lastHunk.type === 'removed') {
          lastHunk.type = 'modified'
          lastHunk.newLines = lines
          lastHunk.startLine = newLineNum
          lastHunk.endLine = newLineNum + lines.length - 1
          newLineNum += lines.length
          continue
        }
      }

      // Pure addition
      hunks.push({
        id: uuidv4(),
        type: 'added',
        startLine: newLineNum,
        endLine: newLineNum + lines.length - 1,
        newLines: lines,
        oldLines: [],
      })
      newLineNum += lines.length
    } else if (change.removed) {
      // Check if the next change is an addition (modification pattern)
      // If so, we'll handle it when we process the addition
      const next = i + 1 < changes.length ? changes[i + 1] : null
      if (next && next.added) {
        // Will be completed when we process the next addition
        hunks.push({
          id: uuidv4(),
          type: 'removed',
          startLine: newLineNum,
          endLine: newLineNum - 1, // Will be updated when addition is processed
          newLines: [],
          oldLines: lines,
        })
      } else {
        // Pure removal
        hunks.push({
          id: uuidv4(),
          type: 'removed',
          startLine: newLineNum,
          endLine: newLineNum - 1, // No new lines occupy space
          newLines: [],
          oldLines: lines,
        })
      }
    }
  }

  return hunks
}

/**
 * Apply only accepted hunks to produce the final body.
 * Accepted hunks use their new content; rejected hunks keep old content.
 */
export function applyAcceptedHunks(
  oldBody: string,
  newBody: string,
  hunks: DiffHunk[],
  acceptedIds: Set<string>,
): string {
  if (acceptedIds.size === hunks.length) {
    // All accepted — use new body directly
    return newBody
  }
  if (acceptedIds.size === 0) {
    // None accepted — keep old body
    return oldBody
  }

  // Rebuild from diff changes
  const changes = diffLines(oldBody, newBody)
  const result: string[] = []
  let hunkIndex = 0

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]

    if (!change.added && !change.removed) {
      // Unchanged — always include
      result.push(change.value)
      continue
    }

    if (change.removed) {
      const next = i + 1 < changes.length ? changes[i + 1] : null
      if (next && next.added) {
        // Modification pair (removed + added)
        const hunk = hunks[hunkIndex++]
        if (hunk && acceptedIds.has(hunk.id)) {
          result.push(next.value) // Use new
        } else {
          result.push(change.value) // Keep old
        }
        i++ // Skip the addition
        continue
      }

      // Pure removal
      const hunk = hunks[hunkIndex++]
      if (!hunk || !acceptedIds.has(hunk.id)) {
        result.push(change.value) // Keep old (reject removal)
      }
      // If accepted, omit the removed lines
      continue
    }

    if (change.added) {
      // Pure addition (not preceded by removal)
      const hunk = hunks[hunkIndex++]
      if (hunk && acceptedIds.has(hunk.id)) {
        result.push(change.value) // Accept addition
      }
      // If rejected, omit the added lines
    }
  }

  return result.join('')
}
