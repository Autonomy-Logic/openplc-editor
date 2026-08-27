/**
 * Resources tab — the C/C++ library folders packaged into the `.stlib`.
 *
 * Dual-card layout, matching the Library Manager: the folders on the left,
 * the selected folder's files on the right. These are files on disk, not
 * project state, so add and remove take effect as they are made — the same
 * way the Library Manager installs an archive.
 */

import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import type { LibraryResourceFolder } from '@root/middleware/shared/ports/project-port'
import { useProject } from '@root/middleware/shared/providers'
import { useCallback, useEffect, useState } from 'react'

import { PlusIcon } from '../../../../../assets/icons/interface/Plus'
import { TrashCanIcon } from '../../../../../assets/icons/interface/TrashCan'
import { useToast } from '../../../[app]/toast/use-toast'

const ResourcesTab = () => {
  const projectPort = useProject()
  const { toast } = useToast()
  const libraryName = useOpenPLCStore((s) => s.project.meta.name)

  const [folders, setFolders] = useState<LibraryResourceFolder[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  /** Folder whose trash icon was clicked, awaiting confirmation. Removing one
   *  deletes its whole tree from disk with nothing to undo it. */
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  // `in` rather than a truthiness check on the members: reading a method off
  // the port without calling it is what the unbound-method rule flags.
  const canManage = 'listLibraryResources' in projectPort && 'addLibraryResource' in projectPort

  const refresh = useCallback(async () => {
    if (!projectPort.listLibraryResources) return
    const result = await projectPort.listLibraryResources()
    setPendingRemoval(null)
    if (!result.success) {
      toast({ title: 'Could not read resources', description: result.error, variant: 'fail' })
      return
    }
    const next = result.folders ?? []
    setFolders(next)
    // Keep the selection only while it still names a folder.
    setSelected((current) => (current && next.some((f) => f.name === current) ? current : (next[0]?.name ?? null)))
  }, [projectPort, toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleAdd = async () => {
    if (!projectPort.addLibraryResource) return
    setIsBusy(true)
    try {
      const result = await projectPort.addLibraryResource()
      // The user dismissed the picker — nothing went wrong, so say nothing.
      if (result.canceled) return
      if (!result.success) {
        toast({ title: 'Could not add the folder', description: result.error, variant: 'fail' })
        return
      }
      await refresh()
      if (result.folder) setSelected(result.folder.name)
      toast({ title: `Added ${result.folder?.name ?? 'folder'}`, variant: 'default' })
    } finally {
      setIsBusy(false)
    }
  }

  const handleRemove = async (name: string) => {
    if (!projectPort.removeLibraryResource) return
    setIsBusy(true)
    try {
      const result = await projectPort.removeLibraryResource(name)
      if (!result.success) {
        toast({ title: `Could not remove ${name}`, description: result.error, variant: 'fail' })
        return
      }
      await refresh()
    } finally {
      setIsBusy(false)
    }
  }

  const selectedFolder = folders.find((folder) => folder.name === selected) ?? null

  return (
    <div className='flex min-h-0 flex-1 gap-4 overflow-hidden'>
      <Card
        title='Library Folders'
        subtitle={
          folders.length === 0
            ? 'No folders yet.'
            : `${folders.length} ${folders.length === 1 ? 'folder' : 'folders'} shipped with ${libraryName}.`
        }
        action={
          canManage ? (
            <button
              type='button'
              onClick={() => void handleAdd()}
              disabled={isBusy}
              aria-label='Add library folder'
              title='Add a library folder to resources'
              className={cn(
                'shrink-0 rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800',
                isBusy && 'cursor-not-allowed opacity-50',
              )}
            >
              <PlusIcon className='!stroke-brand' />
            </button>
          ) : null
        }
      >
        <ListBody>
          {folders.length === 0 ? (
            <EmptyState>
              Add a C/C++ library folder and it ships inside the .stlib, so a project that installs this library
              compiles it for its own target.
            </EmptyState>
          ) : (
            folders.map((folder) => (
              <div
                key={folder.name}
                className={cn(
                  'group flex shrink-0 items-center justify-between gap-2 border-b border-neutral-100 px-2 py-2 last:border-b-0 dark:border-neutral-800',
                  folder.name === selected
                    ? 'bg-neutral-100 dark:bg-neutral-900'
                    : 'hover:bg-neutral-50 dark:hover:bg-neutral-900',
                )}
              >
                <button
                  type='button'
                  onClick={() => setSelected(folder.name)}
                  aria-pressed={folder.name === selected}
                  className='flex min-w-0 flex-1 flex-col gap-0.5 text-left'
                >
                  <span className='truncate font-caption text-cp-sm font-medium text-neutral-950 dark:text-white'>
                    {folder.name}
                  </span>
                  <span className='truncate text-[11px] text-neutral-500 dark:text-neutral-400'>
                    {folder.files.length} {folder.files.length === 1 ? 'file' : 'files'}
                  </span>
                </button>

                {pendingRemoval === folder.name ? (
                  <span className='flex shrink-0 items-center gap-2'>
                    <button
                      type='button'
                      onClick={() => void handleRemove(folder.name)}
                      disabled={isBusy}
                      className={cn(
                        'rounded-md bg-rose-500 px-2 py-0.5 font-caption text-[11px] font-medium text-white hover:bg-rose-600',
                        isBusy && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      Delete
                    </button>
                    <button
                      type='button'
                      onClick={() => setPendingRemoval(null)}
                      className='rounded-md bg-neutral-200 px-2 py-0.5 font-caption text-[11px] font-medium text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type='button'
                    onClick={() => setPendingRemoval(folder.name)}
                    disabled={isBusy}
                    aria-label={`Remove ${folder.name}`}
                    title={`Remove ${folder.name} from resources`}
                    className={cn(
                      'shrink-0 rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800',
                      isBusy && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <TrashCanIcon className='h-4 w-4 stroke-neutral-700 dark:stroke-neutral-400' />
                  </button>
                )}
              </div>
            ))
          )}
        </ListBody>
      </Card>

      <Card
        title={selectedFolder ? selectedFolder.name : 'Files'}
        subtitle={
          selectedFolder
            ? 'Packaged into the .stlib exactly as laid out here.'
            : 'Select a folder to see what it ships.'
        }
      >
        <ListBody>
          {!selectedFolder ? (
            <EmptyState>Nothing selected.</EmptyState>
          ) : selectedFolder.files.length === 0 ? (
            <EmptyState>This folder is empty.</EmptyState>
          ) : (
            selectedFolder.files.map((file) => (
              <div
                key={file}
                title={file}
                className='shrink-0 truncate border-b border-neutral-100 px-2 py-1.5 font-caption text-[11px] text-neutral-700 last:border-b-0 dark:border-neutral-800 dark:text-neutral-400'
              >
                {file}
              </div>
            ))
          )}
        </ListBody>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className='flex min-h-0 w-1/2 min-w-[280px] flex-1 flex-col overflow-hidden rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-950'>
      <div className='flex shrink-0 items-start justify-between gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-700'>
        <div className='min-w-0'>
          <h3 className='select-none truncate font-caption text-sm font-semibold text-neutral-950 dark:text-white'>
            {title}
          </h3>
          {subtitle && <p className='mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400'>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3'>{children}</div>
    </div>
  )
}

/** Scrolling list body. Rows carry `shrink-0`: a flex column shrinks its
 *  children by default, so a long list collapses each row below its own
 *  height instead of scrolling. */
function ListBody({ children }: { children: React.ReactNode }) {
  return <div className='flex min-h-0 flex-1 flex-col overflow-y-auto'>{children}</div>
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex flex-1 items-center justify-center px-3 py-6 text-center text-[11px] italic text-neutral-500 dark:text-neutral-400'>
      {children}
    </div>
  )
}

export { ResourcesTab }
