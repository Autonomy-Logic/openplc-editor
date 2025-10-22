import { useOpenPLCStore } from '@root/renderer/store'
import { getFunctionBlockVariablesToCleanup } from '@root/renderer/store/slices/ladder/utils'
import { PLCVariable } from '@root/types/PLC'
import { cn } from '@root/utils'

import { DividerActivityBar } from '../../_atoms/workspace-activity-bar/divider'
import { DeleteElementButton } from '../../_molecules/workspace-activity-bar/default'
import { BlockButton, CoilButton, ContactButton } from '../../_molecules/workspace-activity-bar/ladder'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'

export const LadderToolbox = () => {
  const {
    editor,
    editorActions: { updateModelVariables },
    ladderFlows,
    ladderFlowActions,
    project: {
      data: { pous },
    },
    projectActions: { deleteVariable },
  } = useOpenPLCStore()

  const editorName = editor.meta.name
  const pou = pous.find((pou) => pou.data.name === editorName)

  const flow = ladderFlows.find((flow) => flow.name === editor.meta.name)
  const selectedNodes = flow?.rungs.flatMap((rung) => rung.selectedNodes) || []

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow/ladder-blocks', iconType)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleRemoveNodes = () => {
    const allNodesToRemove = flow?.rungs.flatMap((rung) => rung.selectedNodes || []) || []

    flow?.rungs.forEach((rung) => {
      ladderFlowActions.removeNodes({
        nodes: rung.selectedNodes || [],
        editorName: editor.meta.name,
        rungId: rung.id,
      })
      ladderFlowActions.setSelectedNodes({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodes: [],
      })
    })

    if (pou && allNodesToRemove.length > 0) {
      const allRungs = flow?.rungs || []
      const allVariables = pou.data.variables as PLCVariable[]

      const variablesToDelete = getFunctionBlockVariablesToCleanup(allNodesToRemove, allRungs, allVariables)

      variablesToDelete.forEach((variableName) => {
        const variableIndex = allVariables.findIndex((v) => v.name.toLowerCase() === variableName.toLowerCase())

        if (variableIndex !== -1) {
          deleteVariable({
            variableName,
            scope: 'local',
            associatedPou: editor.meta.name,
          })

          if (
            editor.type === 'plc-graphical' &&
            editor.variable.display === 'table' &&
            parseInt(editor.variable.selectedRow) === variableIndex
          ) {
            updateModelVariables({ display: 'table', selectedRow: -1 })
          }
        }
      })
    }
  }

  return (
    <>
      <TooltipSidebarWrapperButton tooltipContent='Block'>
        <BlockButton onDragStart={(event) => handleDragStart(event, 'block')} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Coil'>
        <CoilButton onDragStart={(event) => handleDragStart(event, 'coil')} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Contact'>
        <ContactButton onDragStart={(event) => handleDragStart(event, 'contact')} />
      </TooltipSidebarWrapperButton>
      <DividerActivityBar />
      <TooltipSidebarWrapperButton tooltipContent='Delete selected elements'>
        <DeleteElementButton
          onClick={handleRemoveNodes}
          className={cn({
            'disabled cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent': selectedNodes.length === 0,
          })}
        />
      </TooltipSidebarWrapperButton>
    </>
  )
}
