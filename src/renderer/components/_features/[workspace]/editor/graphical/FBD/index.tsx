import { ReactFlowPanel } from '@root/renderer/components/_atoms/react-flow'

export default function FbdEditor() {
  return (
    <div className='h-full w-full'>
      <div className='h-full w-full rounded-lg border p-1 dark:border-neutral-800'>
        <ReactFlowPanel
          controls={true}
          controlsConfig={{
            showInteractive: false,
          }}
          background={true}
        />
      </div>
    </div>
  )
}
