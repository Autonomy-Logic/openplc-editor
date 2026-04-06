import { ComponentPropsWithoutRef } from 'react'

import { useProject } from '../../../../middleware/shared/providers'
import { WarningIcon } from '../../../assets/icons/interface/Warning'
import { useOpenPLCStore } from '../../../store'
import type { FBDFlowType } from '../../../store/slices/fbd'
import type { LadderFlowType } from '../../../store/slices/ladder'
import { getExtensionFromLanguage, getFolderFromPouType } from '../../../utils/PLC/pou-file-extensions'
import { parseGraphicalPouFromString, parseTextualPouFromString } from '../../../utils/PLC/pou-text-parser'
import { executeSaveFile } from '../../../services/save-actions'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

export type SaveChangesFileModalData = {
  fileName: string
}

export type SaveChangesFileModalProps = ComponentPropsWithoutRef<typeof Modal> & {
  isOpen: boolean
  data: SaveChangesFileModalData
}

const SaveChangesFileModal = ({ isOpen, data, ...rest }: SaveChangesFileModalProps) => {
  const {
    project,
    modalActions: { closeModal, onOpenChange },
    projectActions: { applyPouSnapshot, updatePouDocumentation },
    sharedWorkspaceActions: { forceCloseFile },
    fileActions: { updateFile },
    ladderFlowActions: { addLadderFlow },
    fbdFlowActions: { addFBDFlow },
  } = useOpenPLCStore()

  const projectPort = useProject()
  const { fileName } = data

  const handleSave = async () => {
    closeModal()

    const result = await executeSaveFile(fileName, projectPort)
    if (!result.success) return

    forceCloseFile(fileName)
  }

  const handleDontSave = async () => {
    closeModal()

    // Reload the POU from disk to discard in-memory changes
    const pou = project.data.pous.find((p) => p.name === fileName)
    if (pou) {
      try {
        const language = pou.body.language
        const ext = getExtensionFromLanguage(language)
        const folder = getFolderFromPouType(pou.pouType)
        const fullPath = `${project.meta.path}/pous/${folder}/${fileName}${ext}`

        const result = await projectPort.readFileContent(fullPath)
        if (result.success && result.content) {
          const isGraphical = language === 'ld' || language === 'fbd'

          const parsed = isGraphical
            ? parseGraphicalPouFromString(result.content, language, pou.pouType)
            : parseTextualPouFromString(result.content, language, pou.pouType)

          // Restore the full POU from disk: variables, body, and documentation.
          // applyPouSnapshot restores variables + body, then we restore documentation separately.
          applyPouSnapshot(fileName, parsed.interface?.variables ?? [], parsed.body)
          if (parsed.documentation !== undefined) {
            updatePouDocumentation(fileName, parsed.documentation)
          }

          // For graphical POUs, also restore the flow state (nodes, edges, positions).
          // The parsed body.value is the full flow type (same as what addLadderFlow/addFBDFlow
          // receive during project open).
          if (language === 'ld' && parsed.body.value) {
            addLadderFlow(parsed.body.value as LadderFlowType)
          } else if (language === 'fbd' && parsed.body.value) {
            addFBDFlow(parsed.body.value as FBDFlowType)
          }
        }
      } catch {
        // If reload fails, just close without restoring — same as web fallback
      }
    }

    updateFile({ name: fileName, saved: true })
    forceCloseFile(fileName)
  }

  const handleCancel = () => {
    closeModal()
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleCancel()
        }
        onOpenChange('save-changes-file', open)
      }}
      {...rest}
    >
      <ModalContent className='flex h-[420px] w-[340px] select-none flex-col items-center justify-evenly rounded-lg'>
        <ModalTitle className='hidden'>Save file changes</ModalTitle>
        <div className='flex h-[350px] select-none flex-col items-center gap-6'>
          <WarningIcon className='mr-2 mt-2 h-[73px] w-[73px]' />
          <div>
            <p className='text-m w-full text-center font-bold text-gray-600 dark:text-neutral-100'>
              <strong>{fileName}</strong> has unsaved changes. Do you want to save before closing?
            </p>
          </div>

          <div className='flex w-[300px] flex-col text-sm'>
            <div className='mb-6 flex flex-col gap-2'>
              <button
                onClick={() => void handleSave()}
                className='w-full rounded-lg bg-brand px-4 py-2 text-center font-medium text-white'
              >
                Save
              </button>
              <button
                onClick={() => void handleDontSave()}
                className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
              >
                Don't Save
              </button>
            </div>
            <button
              onClick={handleCancel}
              className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { SaveChangesFileModal }
