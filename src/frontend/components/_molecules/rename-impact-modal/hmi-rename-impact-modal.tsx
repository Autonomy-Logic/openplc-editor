import { useOpenPLCStore } from '../../../store'
import { RenameImpactModal } from '.'

/**
 * Store-driven host for renaming a referenced screen or widget block: `hmiActions.rename` parks the question in
 * `pendingHmiRename`. Confirming renames the references too; declining renames only the element and leaves the
 * references for the build to report.
 */
export const HmiRenameImpactModal = () => {
  const pending = useOpenPLCStore((s) => s.pendingHmiRename)
  const respondToPendingRename = useOpenPLCStore((s) => s.hmiActions.respondToPendingRename)

  if (!pending) return null

  return (
    <RenameImpactModal
      open
      title={pending.kind === 'screen' ? 'Screen Rename: Impact Analysis' : 'Widget Block Rename: Impact Analysis'}
      oldName={pending.oldName}
      newName={pending.newName}
      impact={pending.impact}
      affectedListLabel='Affected files:'
      byKindLabel='By kind:'
      cancelDescription='The references keep the old name; the next build reports each of them'
      onConfirm={() => respondToPendingRename(true)}
      onCancel={() => respondToPendingRename(false)}
    />
  )
}
