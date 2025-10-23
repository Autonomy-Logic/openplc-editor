import type { TypeChangeValidationResult } from '@root/renderer/store/slices/project/validation/type-change'
import type { PLCVariable } from '@root/types/PLC/open-plc'

import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../modal'

type TypeChangeModalProps = {
  open: boolean
  variableName: string
  oldType: PLCVariable['type']
  newType: PLCVariable['type']
  validation: TypeChangeValidationResult
  onConfirm: () => void
  onCancel: () => void
}

export const TypeChangeModal = ({
  open,
  variableName,
  oldType,
  newType,
  validation,
  onConfirm,
  onCancel,
}: TypeChangeModalProps) => {
  if (!open) return null

  const hasAffectedNodes = validation.affectedNodes.length > 0

  return (
    <Modal open>
      <ModalContent
        className='flex max-h-[600px] w-[600px] select-none flex-col gap-4 rounded-lg p-8'
        onClose={onCancel}
      >
        <ModalHeader>
          <ModalTitle className='text-sm font-medium text-neutral-950 dark:text-white'>
            Type Change: Impact Analysis
          </ModalTitle>
        </ModalHeader>

        <div className='flex flex-col gap-3 overflow-y-auto'>
          <div className='text-xs text-neutral-600 dark:text-neutral-50'>
            <p className='mb-2'>
              Changing type of <span className='font-semibold'>{variableName}</span> from{' '}
              <span className='font-semibold'>{oldType.value}</span> to{' '}
              <span className='font-semibold'>{newType.value}</span>
            </p>
          </div>

          {validation.warnings.length > 0 && (
            <div className='rounded-md border border-yellow-300 bg-yellow-50 p-3 dark:border-yellow-700 dark:bg-yellow-900/20'>
              <div className='mb-2 text-xs font-semibold text-yellow-800 dark:text-yellow-200'>Warnings:</div>
              <ul className='list-inside list-disc space-y-1 text-xs text-yellow-700 dark:text-yellow-300'>
                {validation.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {hasAffectedNodes && (
            <div className='rounded-md border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800'>
              <div className='mb-3 text-xs font-semibold text-neutral-950 dark:text-white'>Impact Summary:</div>

              <div className='mb-3 grid grid-cols-2 gap-2'>
                <div className='rounded bg-green-100 p-2 dark:bg-green-900/20'>
                  <div className='text-xs font-medium text-green-800 dark:text-green-200'>Compatible Nodes</div>
                  <div className='text-lg font-bold text-green-900 dark:text-green-100'>
                    {validation.compatibleCount}
                  </div>
                </div>
                <div className='rounded bg-red-100 p-2 dark:bg-red-900/20'>
                  <div className='text-xs font-medium text-red-800 dark:text-red-200'>Incompatible Nodes</div>
                  <div className='text-lg font-bold text-red-900 dark:text-red-100'>{validation.incompatibleCount}</div>
                </div>
              </div>

              {validation.incompatibleCount > 0 && (
                <div className='mb-3'>
                  <div className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Incompatible Nodes (will be marked as invalid):
                  </div>
                  <div className='max-h-[200px] overflow-y-auto'>
                    <ul className='space-y-2 text-xs text-neutral-600 dark:text-neutral-400'>
                      {validation.affectedNodes
                        .filter((node) => !node.isCompatible)
                        .map((node, index) => (
                          <li
                            key={index}
                            className='rounded border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-900/10'
                          >
                            <div className='font-medium text-red-800 dark:text-red-200'>
                              {node.pouName} - {node.nodeType}
                            </div>
                            {node.compatibilityMessage && (
                              <div className='mt-1 text-red-600 dark:text-red-400'>{node.compatibilityMessage}</div>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>
              )}

              {validation.compatibleCount > 0 && (
                <div>
                  <div className='mb-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    Compatible Nodes (will continue working):
                  </div>
                  <div className='max-h-[150px] overflow-y-auto'>
                    <ul className='list-inside list-disc space-y-1 text-xs text-neutral-600 dark:text-neutral-400'>
                      {validation.affectedNodes
                        .filter((node) => node.isCompatible)
                        .map((node, index) => (
                          <li key={index}>
                            {node.pouName} - {node.nodeType}
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {!hasAffectedNodes && (
            <div className='rounded-md border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800'>
              <p className='text-xs text-neutral-600 dark:text-neutral-400'>
                No graphical nodes are currently using this variable.
              </p>
            </div>
          )}

          <div className='text-xs text-neutral-600 dark:text-neutral-50'>
            <p className='font-medium'>What would you like to do?</p>
            <ul className='mt-2 list-inside list-disc space-y-1'>
              <li>
                <span className='font-semibold'>Proceed:</span> Apply the type change. Incompatible nodes will be marked
                as invalid (red).
              </li>
              <li>
                <span className='font-semibold'>Cancel:</span> Keep the current type unchanged.
              </li>
            </ul>
          </div>
        </div>

        <ModalFooter className='mt-auto flex justify-end gap-2'>
          <button
            onClick={onCancel}
            className='h-8 w-full rounded bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Cancel
          </button>
          <button onClick={onConfirm} className='h-8 w-full rounded bg-brand px-3 py-1 text-xs text-white'>
            Proceed with Type Change
          </button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
