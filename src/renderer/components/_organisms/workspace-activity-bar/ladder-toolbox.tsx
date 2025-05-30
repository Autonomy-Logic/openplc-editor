import { useOpenPLCStore } from '@root/renderer/store'
import { PLCVariable } from '@root/types/PLC'
import { cn } from '@root/utils'

import { BasicNodeData } from '../../_atoms/graphical-editor/ladder/utils/types'
import { DividerActivityBar } from '../../_atoms/workspace-activity-bar/divider'
import { DeleteElementButton } from '../../_molecules/workspace-activity-bar/default'
import { BlockButton, CoilButton, ContactButton } from '../../_molecules/workspace-activity-bar/ladder'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'
// import { CloseFilledIcon } from '@root/renderer/assets'

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

  // useEffect(() => {
  //   console.log('FLOW UPDATED', flow?.rungs.flatMap((rung) => rung.selectedNodes))
  // }, [flow])

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow/ladder-blocks', iconType)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleRemoveNodes = () => {
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

      /**
       * Remove the variable associated with the block node
       * If the editor is a graphical editor and the variable display is set to table, update the model variables
       * If the variable is the selected row, set the selected row to -1
       *
       * !IMPORTANT: This function must be used inside of components, because the functions deleteVariable and updateModelVariables are just available at the useOpenPLCStore hook
       * -- This block of code references at project:
       *    -- src/renderer/components/_molecules/rung/body.tsx
       *    -- src/renderer/components/_molecules/menu-bar/modals/delete-confirmation-modal.tsx
       *    -- src/renderer/components/_organisms/workspace-activity-bar/ladder-toolbox.tsx
       *    -- src/renderer/components/_molecules/graphical-editor/fbd/index.tsx
       */
      const blockNodes = selectedNodes.filter((node) => node.type === 'block')
      if (blockNodes.length > 0) {
        let variables: PLCVariable[] = []
        if (pou) variables = [...pou.data.variables] as PLCVariable[]

        blockNodes.forEach((blockNode) => {
          const variableData = (blockNode.data as BasicNodeData)?.variable
          const variableIndex = variables.findIndex((variable) => variable.id === variableData?.id)

          if (variableIndex !== -1) {
            deleteVariable({
              variableId: variableData?.id,
              scope: 'local',
              associatedPou: editor.meta.name,
            })
            variables.splice(variableIndex, 1)
          }
          if (
            editor.type === 'plc-graphical' &&
            editor.variable.display === 'table' &&
            parseInt(editor.variable.selectedRow) === variableIndex
          ) {
            updateModelVariables({ display: 'table', selectedRow: -1 })
          }
        })
      }
    })
  }

  return (
    <>
      <TooltipSidebarWrapperButton tooltipContent='Block'>
        <BlockButton
          onDragStart={(event) => handleDragStart(event, 'block')}
          // onDragEnd={(_event) => console.log('drag end ladder toolbox')}
        />
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
