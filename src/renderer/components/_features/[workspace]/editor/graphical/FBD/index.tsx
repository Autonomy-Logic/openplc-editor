import { ReactFlowPanel } from '@root/renderer/components/_atoms/react-flow'
import { useOpenPLCStore } from '@root/renderer/store'

export default function FbdEditor() {
  const { editor, fbdFlows } = useOpenPLCStore()

  const flow = fbdFlows.find((flow) => flow.name === editor.meta.name)

  console.log('flow', flow)

  return (
    <div className='h-full w-full'>
      <div className='h-full w-full rounded-lg border p-1 dark:border-neutral-800'>
        {flow ? (
          <ReactFlowPanel
            controls={true}
            controlsConfig={{
              showInteractive: false,
            }}
            background={true}
          />
        ) : (
          <span>No flow found for editor</span>
        )}
      </div>
    </div>
  )
}
