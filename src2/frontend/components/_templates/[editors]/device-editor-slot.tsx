import { ComponentPropsWithoutRef } from 'react'

type DeviceEditorSlotProps = ComponentPropsWithoutRef<'div'> & {
  heading: string
}

const DeviceEditorSlot = (props: DeviceEditorSlotProps) => {
  return (
    <div
      id='device-editor-slot'
      className='flex h-full w-1/2 min-w-[325px] flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 lg:min-w-[625px] lg:px-8 lg:py-4'
      {...props}
    >
      <h2 id='slot-title' className='select-none text-lg font-medium text-neutral-950 dark:text-white'>
        {props.heading}
      </h2>
      {props.children}
    </div>
  )
}

export { DeviceEditorSlot }
