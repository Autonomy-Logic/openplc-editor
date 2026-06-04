import { Archive, ChevronDown, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type { PendingChange, Stash } from '../../../../../middleware/shared/ports/version-control-port'
import { StashConflictError } from '../../../../../middleware/shared/ports/version-control-port'
import { useProject, useVersionControl } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { notifyNoWritePermission } from '../../../../utils/notify-no-write-permission'
import { isSystemFile } from '../../../../utils/system-files'
import { toast } from '../../../../utils/toast'
import { StashDropConfirmationModal } from './modals/stash-drop-confirmation-modal'

type StashSectionProps = {
  projectId: string
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString()
}

export function StashSection({ projectId }: StashSectionProps) {
  const versionControl = useVersionControl()
  const projectPort = useProject()
  const { versionControlActions, sharedWorkspaceActions } = useOpenPLCStore()
  const canEdit = useOpenPLCStore((s) => s.workspace.canEdit)

  const [stashes, setStashes] = useState<Stash[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<Stash | null>(null)
  const [isDropping, setIsDropping] = useState(false)

  const fetchStashes = useCallback(async () => {
    if (!versionControl) return
    try {
      const { stashes: list } = await versionControl.listStashes(projectId)
      setStashes(list)
    } catch {
      setStashes([])
    } finally {
      setIsLoading(false)
    }
  }, [projectId, versionControl])

  useEffect(() => {
    void fetchStashes()
  }, [fetchStashes])

  // Re-pull project files + pending-changes badge after a stash mutates the
  // working tree — mirrors the discard reload path in ChangesSection.
  const reloadProject = useCallback(async () => {
    try {
      const result = await projectPort.openProjectByPath(projectId)
      if (result.success && result.data) {
        sharedWorkspaceActions.handleOpenProjectResponse(result.data)
      }
    } catch {
      toast({ title: 'Failed to reload project', variant: 'fail' })
    }

    if (versionControl) {
      try {
        const data = await versionControl.getChanges(projectId)
        const visible: PendingChange[] = data.changes.filter((c) => !isSystemFile(c.path))
        versionControlActions.syncFromChanges(visible.map((c) => ({ path: c.path, status: c.status })))
      } catch {
        // Badge stays stale until the next /changes sync — non-fatal.
      }
    }
  }, [projectId, projectPort, sharedWorkspaceActions, versionControl, versionControlActions])

  const handleApplyOrPop = async (stash: Stash, pop: boolean) => {
    if (!versionControl || busyRef) return
    // No write permission ⇒ skip the doomed backend write and warn.
    if (!canEdit) {
      notifyNoWritePermission('modify stashes in')
      return
    }
    setBusyRef(stash.hash)
    try {
      if (pop) await versionControl.popStash(projectId, stash.hash)
      else await versionControl.applyStash(projectId, stash.hash)
      await reloadProject()
      await fetchStashes()
      toast({ title: pop ? 'Stash popped' : 'Stash applied', variant: 'default' })
    } catch (error) {
      if (error instanceof StashConflictError) {
        toast({
          title: 'Stash could not be applied cleanly',
          description: 'Conflicting changes prevent applying this stash. The stash was kept.',
          variant: 'fail',
        })
      } else {
        toast({ title: pop ? 'Failed to pop stash' : 'Failed to apply stash', variant: 'fail' })
      }
    } finally {
      setBusyRef(null)
    }
  }

  const handleDrop = async () => {
    if (!versionControl || !dropTarget) return
    // No write permission ⇒ skip the doomed backend write and warn.
    if (!canEdit) {
      notifyNoWritePermission('modify stashes in')
      return
    }
    setIsDropping(true)
    try {
      await versionControl.dropStash(projectId, dropTarget.hash)
      setDropTarget(null)
      await fetchStashes()
      toast({ title: 'Stash dropped', variant: 'default' })
    } catch {
      setDropTarget(null)
      toast({ title: 'Failed to drop stash', variant: 'fail' })
    } finally {
      setIsDropping(false)
    }
  }

  if (isLoading) {
    return (
      <div className='space-y-2 p-3'>
        {[...Array(3)].map((_, i) => (
          <div key={i} className='h-10 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800' />
        ))}
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 items-center justify-between border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-700'>
        <span className='text-xs text-neutral-500 dark:text-neutral-400'>
          {stashes.length === 0 ? 'No stashes' : `${stashes.length} stash${stashes.length > 1 ? 'es' : ''}`}
        </span>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        {stashes.length === 0 ? (
          <p className='px-3 py-4 text-center text-xs text-neutral-500 dark:text-neutral-400'>
            Stash pending changes from the Changes tab to save them for later.
          </p>
        ) : (
          <ul className='py-1'>
            {stashes.map((stash) => {
              const isBusy = busyRef === stash.hash
              return (
                <li
                  key={stash.hash}
                  className='group border-b border-neutral-100 px-3 py-2 last:border-0 dark:border-neutral-800'
                >
                  <div className='flex items-start gap-2'>
                    <Archive className='mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0464FB]' />
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-xs font-medium text-neutral-800 dark:text-neutral-100'>
                        {stash.message || stash.ref}
                      </p>
                      <p className='mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-400'>
                        {stash.branch && <span className='font-mono'>{stash.branch}</span>}
                        {stash.branch && ' · '}
                        {formatRelativeTime(stash.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className='mt-2 flex items-center gap-1.5 pl-5'>
                    <button
                      onClick={() => void handleApplyOrPop(stash, false)}
                      disabled={isBusy || busyRef !== null}
                      title='Apply this stash and keep it on the stack'
                      className='cursor-pointer rounded-md bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-blue-900/30 dark:hover:text-blue-400'
                    >
                      {isBusy ? '...' : 'Apply'}
                    </button>
                    <button
                      onClick={() => void handleApplyOrPop(stash, true)}
                      disabled={isBusy || busyRef !== null}
                      title='Apply this stash and remove it from the stack'
                      className='flex cursor-pointer items-center gap-1 rounded-md bg-blue-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
                    >
                      <ChevronDown className='h-3 w-3' />
                      Pop
                    </button>
                    <button
                      onClick={() => setDropTarget(stash)}
                      disabled={busyRef !== null}
                      title='Delete this stash without applying'
                      className='ml-auto cursor-pointer rounded-md p-1 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/30 dark:hover:text-red-400'
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <StashDropConfirmationModal
        isOpen={dropTarget !== null}
        isLoading={isDropping}
        stashLabel={dropTarget?.message ?? ''}
        onConfirm={() => void handleDrop()}
        onCancel={() => setDropTarget(null)}
      />
    </div>
  )
}
