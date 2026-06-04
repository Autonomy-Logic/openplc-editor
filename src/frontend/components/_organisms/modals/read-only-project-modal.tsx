/**
 * Read-only project modal — surfaced when the user attempts a write
 * action (save, commit, branch create/delete, POU create/rename/delete,
 * etc.) on a project they don't have edit permission on.  The Monaco /
 * graphical editors are already read-only via the workspace.isReadOnly
 * flag; this modal is the affordance that lets the user act on the
 * problem instead of being silently blocked.
 *
 * Two-step UI driven by local `step` state:
 *   1. 'intro' — explains the situation, offers a Fork button.
 *   2. 'fork'  — folder picker + optional rename → calls forkProject,
 *      then navigates the SPA to the new project's id on success.
 *
 * Folder data comes from `projectPort.listMyFolders()` and is fetched
 * lazily when the user clicks Fork (no round-trip on the intro step).
 */

import { useOpenPLCStore } from '@root/frontend/store'
import { useNavigation, useProject } from '@root/middleware/shared/providers'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ProjectFolder } from '../../../../middleware/shared/ports/project-port'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

type Step = 'intro' | 'fork'

const ReadOnlyProjectModal = () => {
  const isOpen = useOpenPLCStore((s) => s.modals['read-only-project']?.open ?? false)
  const closeModal = useOpenPLCStore((s) => s.modalActions.closeModal)
  const onOpenChange = useOpenPLCStore((s) => s.modalActions.onOpenChange)
  const sourceProjectId = useOpenPLCStore((s) => s.project.meta.path)
  const sourceProjectName = useOpenPLCStore((s) => s.project.meta.name)
  const projectPort = useProject()
  const navigation = useNavigation()

  const [step, setStep] = useState<Step>('intro')
  const [folders, setFolders] = useState<ProjectFolder[] | null>(null)
  const [foldersError, setFoldersError] = useState<string | null>(null)
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [forkName, setForkName] = useState('')
  const [forking, setForking] = useState(false)
  const [forkError, setForkError] = useState<string | null>(null)

  // Reset local state every time the modal closes so a reopen doesn't
  // resume on the fork step with stale folder/name state.
  useEffect(() => {
    if (!isOpen) {
      setStep('intro')
      setFolders(null)
      setFoldersError(null)
      setFoldersLoading(false)
      setSelectedFolderId(null)
      setForkName('')
      setForking(false)
      setForkError(null)
    }
  }, [isOpen])

  const handleStartFork = useCallback(async () => {
    setStep('fork')
    if (folders || foldersLoading) return
    if (!projectPort.listMyFolders) {
      setFoldersError('Folder listing is not supported on this build.')
      return
    }
    setFoldersLoading(true)
    setFoldersError(null)
    const result = await projectPort.listMyFolders()
    setFoldersLoading(false)
    if (!result.success || !result.data) {
      setFoldersError(result.error?.description ?? 'Could not load folders.')
      return
    }
    setFolders(result.data)
    // Auto-select the root folder so the Fork button is enabled
    // immediately for the common case (no folder structure / personal
    // namespace).
    const root = result.data.find((f) => f.type === 'root')
    if (root) setSelectedFolderId(root.id)
  }, [folders, foldersLoading, projectPort])

  const handleConfirmFork = useCallback(async () => {
    if (!selectedFolderId || !projectPort.forkProject) return
    setForking(true)
    setForkError(null)
    const result = await projectPort.forkProject({
      projectId: sourceProjectId,
      destinationFolderId: selectedFolderId,
      ...(forkName.trim() ? { name: forkName.trim() } : {}),
    })
    setForking(false)
    if (!result.success || !result.data) {
      setForkError(result.error?.description ?? 'Fork failed.')
      return
    }
    closeModal()
    // Navigate to the new project's workspace via the platform's
    // NavigationPort.  Web adapter refetches `/details` and reloads with
    // canEdit=true (caller is now the fork owner); the editor adapter is a
    // best-effort no-op (the desktop app has no SPA router and never
    // surfaces a read-only project anyway, so this branch is unreachable
    // there).
    navigation.navigate('/', { project_id: result.data.projectId })
  }, [closeModal, forkName, navigation, projectPort, selectedFolderId, sourceProjectId])

  const flatFolderRows = useMemo(() => (folders ? flattenFolders(folders, 0) : []), [folders])

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeModal()
        onOpenChange('read-only-project', open)
      }}
    >
      {/*
        Base ModalContent centers via `inset-0 m-auto h-[500px]`. Overriding only the
        height to `h-auto` leaves `inset-0` in place — with both top:0 and bottom:0 the
        box is over-constrained and CSS stretches it to fill `max-h`, hence the giant
        empty modal. Switch this modal to translate-centering (`inset-auto` + left/top
        1/2 + -translate-1/2) so the height hugs the content instead.
      */}
      <ModalContent className='!inset-auto !left-1/2 !top-1/2 !m-0 flex !h-auto !max-h-[85vh] !w-[480px] !-translate-x-1/2 !-translate-y-1/2 select-none flex-col gap-4 overflow-y-auto p-6'>
        {step === 'intro' ? (
          <>
            <ModalTitle className='text-lg font-semibold'>This project is read-only</ModalTitle>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>
              <span className='font-medium'>{sourceProjectName}</span> belongs to someone else and you don&apos;t have
              permission to modify it. You can view it, run it on your device, and compile it, but saving, committing,
              and branching are disabled.
            </p>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>
              To make changes, fork the project to your own workspace.
            </p>
            <div className='mt-2 flex flex-col gap-2'>
              <button
                type='button'
                onClick={() => void handleStartFork()}
                className='w-full cursor-pointer rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
              >
                Fork to my workspace
              </button>
              <button
                type='button'
                onClick={() => closeModal()}
                className='w-full cursor-pointer rounded-md px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-900'
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <ModalTitle className='text-lg font-semibold'>Fork project</ModalTitle>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>
              Pick a folder in your workspace where the fork should live.
            </p>

            <div className='flex max-h-56 flex-col overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700'>
              {foldersLoading && <div className='px-3 py-4 text-center text-xs text-neutral-500'>Loading folders…</div>}
              {foldersError && <div className='px-3 py-4 text-center text-xs text-red-500'>{foldersError}</div>}
              {!foldersLoading && !foldersError && flatFolderRows.length === 0 && (
                <div className='px-3 py-4 text-center text-xs text-neutral-500'>No folders available.</div>
              )}
              {flatFolderRows.map((row) => {
                const selected = selectedFolderId === row.id
                return (
                  <button
                    key={row.id}
                    type='button'
                    onClick={() => setSelectedFolderId(row.id)}
                    style={{ paddingLeft: `${row.depth * 16 + 12}px` }}
                    className={`flex w-full cursor-pointer items-center gap-2 border-b border-neutral-100 px-3 py-2 text-left text-sm text-neutral-800 last:border-b-0 dark:border-neutral-800 dark:text-neutral-100 ${
                      selected
                        ? 'bg-brand/10 dark:bg-brand/20 text-brand-medium-dark dark:text-white'
                        : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'
                    }`}
                  >
                    <span className='text-neutral-500'>{'📁'}</span>
                    <span className='truncate'>{row.type === 'root' ? 'Root (/)' : row.name}</span>
                  </button>
                )
              })}
            </div>

            <label className='flex flex-col gap-1 text-sm'>
              <span className='text-neutral-700 dark:text-neutral-300'>Name (optional)</span>
              <input
                type='text'
                value={forkName}
                onChange={(e) => setForkName(e.target.value)}
                placeholder={sourceProjectName}
                maxLength={100}
                className='rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 placeholder-neutral-400 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-500'
              />
            </label>

            {forkError && <p className='text-xs text-red-500'>{forkError}</p>}

            <div className='mt-2 flex gap-2'>
              <button
                type='button'
                onClick={() => setStep('intro')}
                disabled={forking}
                className='flex-1 cursor-pointer rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900'
              >
                Back
              </button>
              <button
                type='button'
                onClick={() => void handleConfirmFork()}
                disabled={!selectedFolderId || forking}
                className='flex-1 cursor-pointer rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
              >
                {forking ? 'Forking…' : 'Fork'}
              </button>
            </div>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

/**
 * Depth-first flatten of the folder hierarchy so the picker can render
 * a single vertical list with indentation per nesting level — simpler
 * than a true tree component and visually equivalent for small org
 * hierarchies (which is what the editor's caller surface produces).
 */
function flattenFolders(
  folders: ProjectFolder[],
  depth: number,
): Array<{ id: string; name: string; type: string; depth: number }> {
  const rows: Array<{ id: string; name: string; type: string; depth: number }> = []
  for (const folder of folders) {
    rows.push({ id: folder.id, name: folder.name, type: folder.type, depth })
    if (folder.children && folder.children.length > 0) {
      rows.push(...flattenFolders(folder.children, depth + 1))
    }
  }
  return rows
}

export { ReadOnlyProjectModal }
