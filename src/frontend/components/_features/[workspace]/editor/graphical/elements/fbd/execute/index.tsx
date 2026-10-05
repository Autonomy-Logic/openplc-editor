import type { Node as FlowNode } from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'

import { useIsDebuggerVisible } from '../../../../../../../../hooks/use-debug-value'
import { useOpenPLCStore } from '../../../../../../../../store'
import { executeStDocumentUri } from '../../../../../../../../utils/PLC/execute-st-uri'
import { StCodeField } from '../../../../../../../_atoms/graphical-editor/st-code-field'
import { Modal, ModalContent, ModalTitle } from '../../../../../../../_molecules/modal'

type ExecuteElementModalProps = {
  isOpen: boolean
  onClose: () => void
  node: FlowNode | null
  pouName: string
}

/**
 * Expanded ST editor for an FBD Execute ("ST Block") element.
 *
 * Twin of the ladder modal — the only differences are which store slice
 * the write-back goes through (`fbdFlowActions`, single rung, no rung
 * id) and which modal id it answers to.
 */
export const ExecuteElementModal = ({ isOpen, onClose, node, pouName }: ExecuteElementModalProps) => {
  const updateNode = useOpenPLCStore((state) => state.fbdFlowActions.updateNode)
  const fbdFlows = useOpenPLCStore((state) => state.fbdFlows)
  const isDebuggerVisible = useIsDebuggerVisible()

  const nodeId = node?.id ?? ''
  const storedCode = ((node?.data ?? {}) as { code?: string }).code ?? ''
  const [code, setCode] = useState(storedCode)

  useEffect(() => {
    if (isOpen) setCode(storedCode)
  }, [isOpen, nodeId, storedCode])

  const commit = useCallback(
    (next: string) => {
      setCode(next)
      if (nodeId === '') return
      const target = fbdFlows.find((flow) => flow.name === pouName)?.rung.nodes.find((n) => n.id === nodeId)
      if (!target) return
      if ((target.data as { code?: string }).code === next) return

      updateNode({
        editorName: pouName,
        nodeId,
        node: { ...target, data: { ...target.data, code: next } },
      })
    },
    [fbdFlows, nodeId, pouName, updateNode],
  )

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <ModalContent
        onClose={onClose}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          onClose()
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault()
          onClose()
        }}
        className='h-[560px] w-[760px] select-none flex-col gap-4 px-8 py-5'
      >
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>
          Execute{isDebuggerVisible ? ' (read-only — debugging)' : ''}
        </ModalTitle>
        <div className='h-full min-h-0 w-full overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-850'>
          <StCodeField
            value={code}
            onCommit={commit}
            uri={executeStDocumentUri(pouName, nodeId)}
            debugPrefix={isDebuggerVisible ? `${pouName}:` : undefined}
            active={isOpen}
            variant='full'
          />
        </div>
      </ModalContent>
    </Modal>
  )
}

export default ExecuteElementModal
