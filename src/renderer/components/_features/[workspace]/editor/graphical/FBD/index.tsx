import { FBDBody } from '@root/renderer/components/_molecules/graphical-editor/fbd'
import { useOpenPLCStore } from '@root/renderer/store'
import { zodFBDFlowSchema } from '@root/renderer/store/slices'
import { useEffect } from 'react'

export default function FbdEditor() {
  const {
    editor,
    fbdFlows,
    workspace: { editingState },

    fbdFlowActions,
    projectActions: { updatePou },
    fileActions: { updateFile, getFile },
    workspaceActions: { setEditingState },
  } = useOpenPLCStore()

  const flow = fbdFlows.find((flow) => flow.name === editor.meta.name)
  const flowUpdated = flow?.updated

  /**
   * Update the flow state to project JSON
   */
  useEffect(() => {
    if (!flowUpdated) return

    const flowSchema = zodFBDFlowSchema.safeParse(flow)
    if (!flowSchema.success) return

    updatePou({
      name: editor.meta.name,
      content: {
        language: 'fbd',
        value: flowSchema.data,
      },
    })

    fbdFlowActions.setFlowUpdated({ editorName: editor.meta.name, updated: false })

    const { file: pouFile } = getFile({ name: editor.meta.name })
    if (pouFile)
      updateFile({
        name: editor.meta.name,
        saved: false,
      })
    if (editingState !== 'unsaved') setEditingState('unsaved')
  }, [flowUpdated])

  return (
    <div className='h-full w-full'>
      {flow?.rung ? <FBDBody rung={flow?.rung} /> : <span>No rung found for editor</span>}
    </div>
  )
}
