import type { Node } from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'

import { useIsDebuggerVisible } from '../../../../../../../../hooks/use-debug-value'
import { useOpenPLCStore } from '../../../../../../../../store'
import { executeStDocumentUri } from '../../../../../../../../utils/PLC/execute-st-uri'
import { executeHeight } from '../../../../../../../_atoms/graphical-editor/ladder/utils/constants'
import { StCodeField } from '../../../../../../../_atoms/graphical-editor/st-code-field'
import { Modal, ModalContent, ModalTitle } from '../../../../../../../_molecules/modal'

type ExecuteElementModalProps = {
  isOpen: boolean
  onClose: () => void
  node: Node | null
  pouName: string
}

/**
 * Expanded ST editor for an Execute ("ST Block") element.
 *
 * Opens on double-click or the node's expand button. Unlike the other
 * graphical element modals it also opens during a debug session — in
 * that case read-only, with live value badges, so the snippet running
 * on the PLC can actually be read (a two-line box on the canvas is not
 * a realistic reading surface for a `CASE` statement).
 */
export const ExecuteElementModal = ({ isOpen, onClose, node, pouName }: ExecuteElementModalProps) => {
  const updateNode = useOpenPLCStore((state) => state.ladderFlowActions.updateNode)
  const ladderFlows = useOpenPLCStore((state) => state.ladderFlows)
  const isDebuggerVisible = useIsDebuggerVisible()

  const nodeId = node?.id ?? ''
  const storedCode = ((node?.data ?? {}) as { code?: string }).code ?? ''
  const [code, setCode] = useState(storedCode)

  // Re-seed whenever a different node is opened (or the same node is
  // reopened after an edit made on the canvas).
  useEffect(() => {
    if (isOpen) setCode(storedCode)
  }, [isOpen, nodeId, storedCode])

  const commit = useCallback(
    (next: string) => {
      setCode(next)
      if (nodeId === '') return
      const rung = ladderFlows
        .find((flow) => flow.name === pouName)
        ?.rungs.find((candidate) => candidate.nodes.some((n) => n.id === nodeId))
      const target = rung?.nodes.find((n) => n.id === nodeId)
      if (!rung || !target) return
      if ((target.data as { code?: string }).code === next) return

      const height = executeHeight(next === '' ? 0 : next.split('\n').length)
      updateNode({
        editorName: pouName,
        rungId: rung.id,
        nodeId,
        node: {
          ...target,
          height,
          measured: { width: target.width ?? 0, height },
          data: { ...target.data, code: next },
        },
      })
    },
    [ladderFlows, nodeId, pouName, updateNode],
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
