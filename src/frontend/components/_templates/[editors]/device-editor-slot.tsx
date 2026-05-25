import { ComponentPropsWithoutRef } from 'react'

type DeviceEditorSlotProps = ComponentPropsWithoutRef<'div'> & {
  // Optional because some screens want the heading inline with the content
  // (e.g. next to a preview image on the same flex row).
  heading?: string
}

const DeviceEditorSlot = ({ heading, children, ...rest }: DeviceEditorSlotProps) => {
  return (
    <div
      id='device-editor-slot'
      className='flex h-full w-full flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 lg:px-8 lg:py-4'
      {...rest}
    >
      {heading && (
        <h2 id='slot-title' className='select-none text-lg font-medium text-neutral-950 dark:text-white'>
          {heading}
        </h2>
      )}
      {children}
    </div>
  )
}

export { DeviceEditorSlot }
