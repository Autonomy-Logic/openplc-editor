import { FBDBody } from '@root/renderer/components/_molecules/graphical-editor/fbd'
import { useOpenPLCStore } from '@root/renderer/store'

export default function FbdEditor() {
  const { editor, fbdFlows } = useOpenPLCStore()
  const flow = fbdFlows.find((flow) => flow.name === editor.meta.name)

  return (
    <div className='h-full w-full'>
      {flow?.rung ? <FBDBody rung={flow?.rung} /> : <span>No rung found for editor</span>}
    </div>
  )
}
