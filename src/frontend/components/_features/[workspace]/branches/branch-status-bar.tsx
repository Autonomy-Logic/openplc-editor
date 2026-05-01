import { useCallback, useRef, useState } from 'react'

import type { Branch } from '../../../../../middleware/shared/ports/version-control-port'
import { useNavigation, useVersionControl } from '../../../../../middleware/shared/providers'
import { useActiveBranch } from '../../../../hooks/use-active-branch'
import { BranchSwitcherPopover } from './branch-switcher-popover'
import { DeleteBranchModal } from './delete-branch-modal'
import { UnsavedChangesWarningModal } from './unsaved-changes-warning-modal'

type BranchStatusBarProps = {
  projectId: string
  onBranchSwitch?: (branchName: string) => void
}

export function BranchStatusBar({ projectId, onBranchSwitch }: BranchStatusBarProps) {
  const versionControl = useVersionControl()
  const navigation = useNavigation()
  const [activeBranchName, setActiveBranch] = useActiveBranch(projectId)
  const branchButtonRef = useRef<HTMLButtonElement>(null)

  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false)
  const [branchToDelete, setBranchToDelete] = useState<Branch | null>(null)
  const [pendingBranchSwitch, setPendingBranchSwitch] = useState<Branch | null>(null)

  const doSwitch = useCallback(
    async (branch: Branch) => {
      if (!versionControl) return
      try {
        await versionControl.switchBranch(projectId, branch.name)
        setActiveBranch(branch.name)
        onBranchSwitch?.(branch.name)
      } catch (error) {
        console.error('Failed to switch branch:', error)
      }
    },
    [projectId, versionControl, setActiveBranch, onBranchSwitch],
  )

  const handleSelect = useCallback(
    async (branch: Branch) => {
      if (branch.name === activeBranchName) return
      if (!versionControl) return

      // Check for unsaved changes before switching
      try {
        const { changes } = await versionControl.getChanges(projectId, activeBranchName)
        if (changes.length > 0) {
          setPendingBranchSwitch(branch)
          setShowSwitcher(false)
          setShowUnsavedWarning(true)
          return
        }
      } catch {
        // If we can't check, proceed with switch
      }

      doSwitch(branch)
    },
    [activeBranchName, projectId, versionControl, doSwitch],
  )

  const handleDiscardAndSwitch = useCallback(async () => {
    if (pendingBranchSwitch) {
      setShowUnsavedWarning(false)
      await doSwitch(pendingBranchSwitch)
      setPendingBranchSwitch(null)
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
        onDiscard={handleDiscardAndSwitch}
        onCancel={handleCancelSwitch}
      />
    </>
  )
}
