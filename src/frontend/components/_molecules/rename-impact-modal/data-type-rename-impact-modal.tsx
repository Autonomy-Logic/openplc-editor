import { useOpenPLCStore } from '../../../store'
import { RenameImpactModal } from '.'

/**
 * Store-driven host for the data type rename flow: `datatypeActions.rename`
 * parks the awaited confirmation in `pendingDatatypeRename`, this renders the
 * impact modal for it, and confirm/cancel resolve the pending promise via
 * `respondToPendingRename`.
 */
export const DataTypeRenameImpactModal = () => {
  const pending = useOpenPLCStore((s) => s.pendingDatatypeRename)
  const respondToPendingRename = useOpenPLCStore((s) => s.datatypeActions.respondToPendingRename)

  if (!pending) return null

  return (
    <RenameImpactModal
      open
      title='Data Type Rename: Impact Analysis'
      oldName={pending.oldName}
      newName={pending.newName}
      impact={pending.impact}
      affectedListLabel='Affected locations:'
      byKindLabel='By reference kind:'
      cancelLabel='No, cancel rename'
      cancelDescription='The data type keeps its current name and nothing is changed'
      onConfirm={() => respondToPendingRename(true)}
      onCancel={() => respondToPendingRename(false)}
    />
  )
}
