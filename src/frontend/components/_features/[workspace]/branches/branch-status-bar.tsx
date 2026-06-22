import { useCallback, useRef, useState } from 'react'

import type { Branch } from '../../../../../middleware/shared/ports/version-control-port'
import { SwitchBranchCarryConflictError } from '../../../../../middleware/shared/ports/version-control-port'
import { useNavigation, useVersionControl } from '../../../../../middleware/shared/providers'
import { useActiveBranch } from '../../../../hooks/use-active-branch'
import { useOpenPLCStore } from '../../../../store'
import { toast } from '../../../../utils/toast'
import { BranchSwitcherPopover } from './branch-switcher-popover'
import { DeleteBranchModal } from './delete-branch-modal'
import type { CarryCheckState } from './unsaved-changes-warning-modal'
import { UnsavedChangesWarningModal } from './unsaved-changes-warning-modal'

type BranchStatusBarProps = {
  projectId: string
  onBranchSwitch?: (branchName: string) => void
}

export function BranchStatusBar({ projectId, onBranchSwitch }: BranchStatusBarProps) {
  const versionControl = useVersionControl()
  const navigation = useNavigation()
  const checkIfAllFilesAreSaved = useOpenPLCStore((s) => s.fileActions.checkIfAllFilesAreSaved)
  const pendingChangesCount = useOpenPLCStore((s) => s.versionControl.pendingChangesCount)
  const [activeBranchName, setActiveBranch] = useActiveBranch(projectId)
  const branchButtonRef = useRef<HTMLButtonElement>(null)

  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false)
  const [branchToDelete, setBranchToDelete] = useState<Branch | null>(null)
  const [pendingBranchSwitch, setPendingBranchSwitch] = useState<Branch | null>(null)
  const [carryCheckState, setCarryCheckState] = useState<CarryCheckState>('loading')
  const [conflictedFiles, setConflictedFiles] = useState<string[]>([])

  const doSwitch = useCallback(
    async (branch: Branch, strategy: 'discard' | 'carry' = 'discard') => {
      if (!versionControl) return
      try {
        await versionControl.switchBranch(projectId, branch.name, strategy)
        setActiveBranch(branch.name)
        onBranchSwitch?.(branch.name)
        return { ok: true as const }
      } catch (error) {
        if (error instanceof SwitchBranchCarryConflictError) {
          return { ok: false as const, conflictedFiles: error.conflictedFiles }
        }
        console.error('Failed to switch branch:', error)
        return { ok: false as const, conflictedFiles: [] as string[] }
      }
    },
    [projectId, versionControl, setActiveBranch, onBranchSwitch],
  )

  const handleSelect = useCallback(
    async (branch: Branch) => {
      if (branch.name === activeBranchName) return
      if (!versionControl) return

      // Block the switch when the editor has unsaved (not-yet-persisted) edits.
      // The switch reloads the project from the server (handleBranchSwitch ->
      // openProjectByPath), which would silently wipe in-memory editor state.
      // `getChanges` below only sees server-side working-tree changes and can't
      // detect these, so we guard here and let the user decide what to do with
      // them (save via Ctrl+S, or discard) rather than persisting on their
      // behalf — they may not want to keep these edits.
      if (!checkIfAllFilesAreSaved()) {
        toast({
          title: 'Unsaved changes',
          description: 'Save or discard your changes before switching branches.',
          variant: 'warn',
        })
        setShowSwitcher(false)
        return
      }

      // Warn before switching if there are uncommitted changes. The store's
      // pendingChangesCount (the same signal the source-control panel shows) is
      // the primary trigger: the live getChanges round-trip is best-effort and
      // the backend returns an empty list on any error, so relying on it alone
      // would let us switch silently over pending work the user can see.
      let hasUncommittedChanges = pendingChangesCount > 0
      try {
        const { changes } = await versionControl.getChanges(projectId, activeBranchName)
        if (changes.length > 0) hasUncommittedChanges = true
      } catch {
        // Live check failed — fall back to the store signal above.
      }

      if (hasUncommittedChanges) {
        setPendingBranchSwitch(branch)
        setShowSwitcher(false)
        setCarryCheckState('loading')
        setConflictedFiles([])
        setShowUnsavedWarning(true)

        // Fire the pre-check in parallel so the modal opens immediately
        // and updates as soon as the dry-run lands.
        void versionControl
          .previewSwitchCarry(projectId, branch.name)
          .then((result) => {
            if (result.conflicts.length > 0) {
              setCarryCheckState('conflict')
              setConflictedFiles(result.conflicts)
            } else {
              setCarryCheckState('available')
              setConflictedFiles([])
            }
          })
          .catch((err) => {
            console.error('Failed to preview carry:', err)
            setCarryCheckState('error')
          })
        return
      }

      doSwitch(branch)
    },
    [activeBranchName, projectId, versionControl, doSwitch, checkIfAllFilesAreSaved, pendingChangesCount],
  )

  const handleDiscardAndSwitch = useCallback(async () => {
    if (!pendingBranchSwitch) return
    setShowUnsavedWarning(false)
    await doSwitch(pendingBranchSwitch, 'discard')
    setPendingBranchSwitch(null)
  }, [pendingBranchSwitch, doSwitch])

  const handleCarryAndSwitch = useCallback(async () => {
    if (!pendingBranchSwitch) return
    // Snapshot the branch — `doSwitch` clears state on success.
    const branch = pendingBranchSwitch
    const result = await doSwitch(branch, 'carry')
    if (!result) return
    if (result.ok) {
      setShowUnsavedWarning(false)
      setPendingBranchSwitch(null)
      return
    }
    // Race: the preview said "ok" but the apply hit a conflict (or another
    // error happened). Surface conflicts in the still-open modal.
    if (result.conflictedFiles.length > 0) {
      setCarryCheckState('conflict')
      setConflictedFiles(result.conflictedFiles)
    } else {
      setCarryCheckState('error')
    }
  }, [pendingBranchSwitch, doSwitch])

  const handleCancelSwitch = useCallback(() => {
    setShowUnsavedWarning(false)
    setPendingBranchSwitch(null)
  }, [])

  const handleDelete = useCallback((branch: Branch) => {
    setBranchToDelete(branch)
    setShowSwitcher(false)
    setShowDelete(true)
  }, [])

  const handleMerge = useCallback(
    (branch: Branch) => {
      // Source is the clicked branch; default target to the active branch
      // (if different). When source == active, omit `target` entirely so the
      // merge page can apply its own default rather than receiving `target=`.
      navigation.navigate('/merge', {
        project_id: projectId,
        source: branch.name,
        target: activeBranchName !== branch.name ? activeBranchName : undefined,
      })
    },
    [projectId, activeBranchName, navigation],
  )

  const handleDeleted = useCallback(() => {
    if (!versionControl) return
    if (branchToDelete?.name === activeBranchName) {
      // Fetch fresh branches to find the default and switch to it
      versionControl
        .listBranches(projectId)
        .then(({ branches }) => {
          const defaultBranch = branches.find((b) => b.isDefault)
          if (defaultBranch) {
            doSwitch(defaultBranch)
          }
        })
        .catch(() => {})
    }
    setBranchToDelete(null)
  }, [branchToDelete, activeBranchName, projectId, versionControl, doSwitch])

  return (
    <>
      <div className='flex h-6 w-full shrink-0 items-center bg-brand-dark px-2 dark:bg-neutral-950'>
        <button
          ref={branchButtonRef}
          onClick={() => setShowSwitcher(true)}
          className='flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs text-white transition-colors hover:bg-brand-medium-dark dark:text-neutral-400 dark:hover:bg-neutral-900'
          title='Switch branch'
        >
          <svg className='h-3.5 w-3.5' viewBox='0 0 16 16' fill='currentColor'>
            <path d='M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z' />
          </svg>
          <span className='max-w-[200px] truncate font-mono text-xs'>{activeBranchName}</span>
        </button>
      </div>

      <BranchSwitcherPopover
        isOpen={showSwitcher}
        projectId={projectId}
        currentBranchName={activeBranchName}
        anchorRef={branchButtonRef}
        onClose={() => setShowSwitcher(false)}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onMerge={handleMerge}
      />

      <DeleteBranchModal
        isOpen={showDelete}
        projectId={projectId}
        branch={branchToDelete}
        onClose={() => {
          setShowDelete(false)
          setBranchToDelete(null)
        }}
        onDeleted={handleDeleted}
      />

      <UnsavedChangesWarningModal
        isOpen={showUnsavedWarning}
        targetBranchName={pendingBranchSwitch?.name ?? ''}
        carryCheckState={carryCheckState}
        conflictedFiles={conflictedFiles}
        onDiscard={handleDiscardAndSwitch}
        onCarry={handleCarryAndSwitch}
        onCancel={handleCancelSwitch}
      />
    </>
  )
}
