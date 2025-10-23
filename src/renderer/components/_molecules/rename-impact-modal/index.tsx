import type { ReferenceImpactAnalysis } from '@root/renderer/utils/variable-references'

import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../modal'

type RenameImpactModalProps = {
  open: boolean
  oldName: string
  newName: string
  impact: ReferenceImpactAnalysis
  onConfirm: () => void
  onCancel: () => void
}

export const RenameImpactModal = ({ open, oldName, newName, impact, onConfirm, onCancel }: RenameImpactModalProps) => {
  if (!open) return null

  return (
    <Modal open>
      <ModalContent
        className='flex max-h-[600px] w-[600px] select-none flex-col gap-4 rounded-lg p-8'
        onClose={onCancel}
      >
        <ModalHeader>
          <ModalTitle className='text-sm font-medium text-neutral-950 dark:text-white'>
            Rename Variable: Impact Analysis
          </ModalTitle>
        </ModalHeader>

        <div className='flex flex-col gap-3 overflow-y-auto'>
          <div className='text-xs text-neutral-600 dark:text-neutral-50'>
            <p className='mb-2'>
              Renaming <span className='font-semibold'>{oldName}</span> to{' '}
              <span className='font-semibold'>{newName}</span> will affect:
            </p>
          </div>

          <div className='rounded-md border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800'>
            <div className='mb-3 text-xs font-semibold text-neutral-950 dark:text-white'>
              Total References: {impact.totalReferences}
            </div>

            {impact.byPou.size > 0 && (
              <div className='mb-3'>
                <div className='mb-1 text-xs font-medium text-neutral-700 dark:text-neutral-300'>Affected POUs:</div>
                <ul className='list-inside list-disc space-y-1 text-xs text-neutral-600 dark:text-neutral-400'>
                  {Array.from(impact.byPou.entries()).map(([pouName, count]) => (
                    <li key={pouName}>
                      {pouName}: {count} reference{count !== 1 ? 's' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {impact.byEditorType.size > 0 && (
              <div>
                <div className='mb-1 text-xs font-medium text-neutral-700 dark:text-neutral-300'>By Editor Type:</div>
                <ul className='list-inside list-disc space-y-1 text-xs text-neutral-600 dark:text-neutral-400'>
                  {Array.from(impact.byEditorType.entries()).map(([editorType, count]) => (
                    <li key={editorType}>
                      {editorType.toUpperCase()}: {count} reference{count !== 1 ? 's' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className='text-xs text-neutral-600 dark:text-neutral-50'>
            <p className='font-medium'>What would you like to do?</p>
            <ul className='mt-2 list-inside list-disc space-y-1'>
              <li>
                <span className='font-semibold'>Yes, rename references:</span> All references will be updated to use the
                new name
              </li>
              <li>
                <span className='font-semibold'>No, keep references unchanged:</span> References will remain with the
                old name and become invalid
              </li>
            </ul>
          </div>
        </div>

        <ModalFooter className='mt-auto flex justify-end gap-2'>
          <button
            onClick={onCancel}
            className='h-8 w-full rounded bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
          >
            No, keep references unchanged
          </button>
          <button onClick={onConfirm} className='h-8 w-full rounded bg-brand px-3 py-1 text-xs text-white'>
            Yes, rename references
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
