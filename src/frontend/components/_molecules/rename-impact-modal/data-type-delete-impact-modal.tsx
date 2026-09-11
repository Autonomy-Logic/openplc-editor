import { useOpenPLCStore } from '../../../store'
import { toast } from '../../_features/[app]/toast/use-toast'
import { RenameImpactModal } from '.'

/**
 * Store-driven host for the data type delete flow: `datatypeActions.deleteRequest`
 * parks a still-referenced type in `pendingDatatypeDelete`, this renders the
 * impact modal for it, and confirm/cancel go through `respondToPendingDelete`.
 * References are left in place on purpose — the modal is the warning.
 */
export const DataTypeDeleteImpactModal = () => {
  const pending = useOpenPLCStore((s) => s.pendingDatatypeDelete)
  const respondToPendingDelete = useOpenPLCStore((s) => s.datatypeActions.respondToPendingDelete)

  if (!pending) return null

  const { name, impact } = pending
  const count = impact.totalReferences
  const references = count === 1 ? '1 reference now points' : `${count} references now point`

  const handleConfirm = () => {
    respondToPendingDelete(true)
    toast({
      title: 'Data type deleted',
      description: `"${name}" was deleted. ${references} to a missing type.`,
      variant: 'default',
    })
  }

  return (
    <RenameImpactModal
      open
      title='Data Type Delete: Impact Analysis'
      impact={impact}
      description={
        <>
          Deleting <span className='font-semibold'>{name}</span> will leave these references without a type:
        </>
      }
      affectedListLabel='Affected locations:'
      byKindLabel='By reference kind:'
      confirmLabel='Yes, delete anyway'
      confirmDescription='The data type is removed and the listed references keep its name until you retype them'
      cancelLabel='No, keep data type'
      cancelDescription='Nothing is changed'
      onConfirm={handleConfirm}
      onCancel={() => respondToPendingDelete(false)}
    />
  )
}
