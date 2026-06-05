import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { getFunctionBlockVariablesToCleanup } from '../../../utils/graphical/get-function-block-variables-to-cleanup'
import { DividerActivityBar } from '../../_atoms/workspace-activity-bar/divider'
import { removeElements } from '../../_molecules/graphical-editor/ladder/rung/ladder-utils/elements'
import { DeleteElementButton } from '../../_molecules/workspace-activity-bar/default/exit'
import { BlockButton } from '../../_molecules/workspace-activity-bar/ladder/block'
import { CoilButton } from '../../_molecules/workspace-activity-bar/ladder/coil'
import { ContactButton } from '../../_molecules/workspace-activity-bar/ladder/contact'
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
  const pou = pous.find((pou) => pou.name === editorName)

  const flow = ladderFlows.find((flow) => flow.name === editor.meta.name)
  const selectedNodes = flow?.rungs.flatMap((rung) => rung.selectedNodes) || []

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow/ladder-blocks', iconType)
    event.dataTransfer.setData('text/plain', iconType)
    event.dataTransfer.effectAllowed = 'move'

    // Safari/WebKit: Create a visible drag image with better contrast
    const iconElement = event.currentTarget.firstElementChild as HTMLElement
    if (iconElement) {
      // Get the button's background color to preserve theme (light/dark mode)
      const buttonElement = event.currentTarget.parentElement
      const computedStyle = buttonElement ? window.getComputedStyle(buttonElement) : null
      const bgColor = computedStyle?.backgroundColor || 'rgb(255, 255, 255)'

      // Create a wrapper matching the button style
      const dragImage = document.createElement('div')
      dragImage.style.backgroundColor = bgColor
      dragImage.style.borderRadius = '6px'
      dragImage.style.padding = '4px'
      dragImage.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.15)'
      dragImage.style.position = 'absolute'
      dragImage.style.top = '-1000px'

      // Clone the icon into the wrapper
      const iconClone = iconElement.cloneNode(true) as HTMLElement
      dragImage.appendChild(iconClone)
      document.body.appendChild(dragImage)

      // Set as drag image (adjusted offset for smaller wrapper)
      event.dataTransfer.setDragImage(dragImage, 16, 16)

      // Clean up after drag starts
      setTimeout(() => document.body.removeChild(dragImage), 0)
    }
  }

  const handleRemoveNodes = () => {
    const allNodesToRemove = flow?.rungs.flatMap((rung) => rung.selectedNodes || []) || []

    flow?.rungs.forEach((rung) => {
      const selectedNodes = rung.selectedNodes || []
      if (selectedNodes.length === 0) return

      const { nodes: newNodes, edges: newEdges } = removeElements({ ...rung }, selectedNodes)
      ladderFlowActions.setNodes({ editorName: editor.meta.name, rungId: rung.id, nodes: newNodes })
      ladderFlowActions.setEdges({ editorName: editor.meta.name, rungId: rung.id, edges: newEdges })
      ladderFlowActions.setSelectedNodes({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodes: [],
      })
    })

    if (pou && allNodesToRemove.length > 0) {
      const allRungs = flow?.rungs || []
      const allVariables = pou.interface?.variables || []

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
