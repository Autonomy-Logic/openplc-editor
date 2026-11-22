import { useOpenPLCStore } from '../../../store'
import { RenameImpactModal } from '.'

/**
 * Store-driven host for renaming a referenced screen or widget block: `hmiActions.rename` parks the question in
 * `pendingHmiRename`. Confirming renames the references too; "Rename only" leaves them for the build to report;
 * cancelling or closing renames nothing.
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
      alternative={{
        label: 'Rename only',
        description: 'The references keep the old name; the next build reports each of them',
        onChoose: () => respondToPendingRename(false),
      }}
      cancelLabel='Cancel rename'
      cancelDescription='Nothing is renamed'
      onConfirm={() => respondToPendingRename(true)}
      onCancel={() => respondToPendingRename(null)}
    />
  )
}
