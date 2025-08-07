import { GlobalVariablesEditor } from '@root/renderer/components/_organisms/global-variables-editor'
import { InstancesEditor } from '@root/renderer/components/_organisms/instances-editor'
import { TaskEditor } from '@root/renderer/components/_organisms/task-editor'
import { useUndoRedoShortcut } from '@root/renderer/hooks/useUndoRedoShortcut'
import { useOpenPLCStore } from '@root/renderer/store'

const ResourcesEditor = () => {
  const {
    editor,
    projectActions: { undo, redo },
  } = useOpenPLCStore()

  useUndoRedoShortcut({
    undo: () => undo(editor.meta.name),
    redo: () => redo(editor.meta.name),
  })

  return (
    <div className=' flex h-full w-full flex-col gap-8 overflow-y-auto'>
      <GlobalVariablesEditor />

      <TaskEditor />

      <InstancesEditor />
    </div>
  )
}

export { ResourcesEditor }
