/**
 * DiffViewerEditor — the read-only "source control diff" editor tab.
 *
 * Opened from the Source Control panel when the user clicks a changed file.
 * Renders the same Working Tree ↔ HEAD comparison as the commit-details page:
 *   - original (HEAD): the committed content of the file, taken straight from
 *     the backend's `/changes?includeContent=true` response (the `before`
 *     field). The backend computes this against the actually checked-out HEAD,
 *     so there's no client-side guessing about commit ordering or branch.
 *   - current (working tree): `buildAllProjectFileContents()`, which echoes the
 *     raw loaded bytes for files untouched this session (so a pre-existing
 *     pending change diffs raw-vs-raw, no serialization noise) and the freshly
 *     serialized form for files edited this session — keeping the diff live.
 *
 * The HEAD `before` map is cached in the version-control slice (`headContent`)
 * and invalidated on project load / commit / in-place reload, plus pruned
 * per-path on save (`recordSavedFiles`). The fetch below refires whenever the
 * open path has no cached entry, so a viewer that stayed mounted across a
 * commit (which empties the pending set) picks up the new HEAD on the next
 * change instead of diffing against a stale snapshot.
 */

import { useEffect, useMemo } from 'react'

import { useVersionControl } from '../../../../../../middleware/shared/providers'
import { buildAllProjectFileContents } from '../../../../../services/save-actions'
import { useOpenPLCStore } from '../../../../../store'
import { cn } from '../../../../../utils/cn'
import { FileDiffView } from './file-diff-view'

export { FileDiffView, getLanguageFromPath, isGraphicalFile } from './file-diff-view'
export { GraphicalDiffViewer } from './graphical-diff-viewer'

// Mirrors the status badge on the commit-details (history) page so the
// source-control diff tab reads identically.
type FileStatus = 'A' | 'M' | 'D' | 'U'

const FILE_STATUS_CONFIG: Record<FileStatus, { label: string; badge: string }> = {
  A: { label: 'Added', badge: 'bg-green-500/10 text-green-500' },
  M: { label: 'Modified', badge: 'bg-yellow-500/10 text-yellow-500' },
  D: { label: 'Deleted', badge: 'bg-red-500/10 text-red-500' },
  U: { label: 'Unchanged', badge: 'bg-neutral-500/10 text-neutral-400' },
}

function deriveStatus(original: string, current: string): FileStatus {
  if (original === current) return 'U'
  if (!original) return 'A'
  if (!current) return 'D'
  return 'M'
}

export function DiffViewerEditor() {
  const editor = useOpenPLCStore((s) => s.editor)
  const projectId = useOpenPLCStore((s) => s.project.meta.path)
  const versionControl = useVersionControl()

  // Re-render (and recompute `current` below) whenever project state changes
  // so the diff stays live as the user edits.
  const project = useOpenPLCStore((s) => s.project)

  // Per-path HEAD (committed) content of the changed files — the `before` side
  // of each diff. `null` = not yet loaded → fetched lazily below.
  const headContent = useOpenPLCStore((s) => s.versionControl.headContent)
  const setHeadContent = useOpenPLCStore((s) => s.versionControlActions.setHeadContent)
  const mergeHeadContent = useOpenPLCStore((s) => s.versionControlActions.mergeHeadContent)

  const filePath = editor.type === 'diff-viewer' ? editor.meta.filePath : ''

  // The cached snapshot serves this diff only when it has an entry for the
  // open path. A missing entry means the cache predates the change being
  // viewed (e.g. it was rebuilt while a commit had emptied the pending set),
  // so it must be refetched — rendering it would diff against a wrong HEAD.
  const headReady = headContent !== null && (!filePath || headContent[filePath] !== undefined)

  // Lazily fetch the HEAD content of all pending files via the backend's
  // content-bearing /changes call (authoritative against the real HEAD), and
  // cache the `before` map. Invalidated on load / commit / reload and pruned
  // per-path on save.
  useEffect(() => {
    if (headReady || !projectId || !versionControl) return
    let cancelled = false
    // Snapshot the working-tree bytes before fetching: if `filePath` turns
    // out to have no pending change, its working tree equals HEAD, so these
    // bytes ARE its HEAD content. Caching them keeps `headReady` from
    // refetching in a loop and gives later diffs the correct original side.
    let workingTreeSnapshot = ''
    if (filePath) {
      try {
        workingTreeSnapshot = buildAllProjectFileContents()[filePath] ?? ''
      } catch {
        workingTreeSnapshot = ''
      }
    }
    void (async () => {
      try {
        const { changes } = await versionControl.getChanges(projectId, undefined, true)
        const map: Record<string, string> = {}
        for (const c of changes) map[c.path] = c.before ?? ''
        if (filePath && map[filePath] === undefined) map[filePath] = workingTreeSnapshot
        if (!cancelled) setHeadContent(map)
      } catch {
        // Cache an (empty) entry for the open path even on failure so
        // `headReady` doesn't retry in a tight loop; the next mount or path
        // change triggers a fresh attempt.
        if (!cancelled) mergeHeadContent(filePath ? { [filePath]: '' } : {})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [headReady, filePath, projectId, versionControl, setHeadContent, mergeHeadContent])

  const original = headReady && headContent && filePath ? (headContent[filePath] ?? '') : ''

  // The working-tree side: raw loaded bytes for files untouched this session,
  // freshly serialized for edited ones. Recomputed when `project` changes.
  const current = useMemo(
    () => {
      if (!filePath) return ''
      try {
        return buildAllProjectFileContents()[filePath] ?? ''
      } catch {
        return ''
      }
    },
    // `project` drives recomputation; `buildAllProjectFileContents` reads the
    // live store internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filePath, project],
  )

  if (editor.type !== 'diff-viewer') return null

  const isDark = document.documentElement.classList.contains('dark')

  // Card chrome + header identical to the commit-details (history) page panel.
  return (
    <div className='flex h-full w-full flex-col p-2'>
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border-2 border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950'>
        <div className='flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800'>
          <p className='flex-1 truncate font-mono text-xs text-neutral-600 dark:text-neutral-400'>{filePath}</p>
          {headReady && (
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold',
                FILE_STATUS_CONFIG[deriveStatus(original, current)].badge,
              )}
            >
              {FILE_STATUS_CONFIG[deriveStatus(original, current)].label}
            </span>
          )}
        </div>
        <div className='min-h-0 flex-1'>
          {!headReady ? (
            <div className='flex h-full items-center justify-center'>
              <div className='flex flex-col items-center gap-3'>
                <div className='h-5 w-5 animate-spin rounded-full border-2 border-brand-light border-t-transparent' />
                <p className='text-xs text-neutral-500 dark:text-neutral-400'>Loading diff…</p>
              </div>
            </div>
          ) : (
            <FileDiffView filePath={filePath} original={original} current={current} isDark={isDark} />
          )}
        </div>
      </div>
    </div>
  )
}
