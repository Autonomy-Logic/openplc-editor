import { ComponentPropsWithoutRef } from 'react'

type DeviceEditorTemplateProps = ComponentPropsWithoutRef<'div'>

type DeviceEditorSlotProps = ComponentPropsWithoutRef<'div'> & {
  heading: string
}

const DeviceEditorLeftSlot = (props: DeviceEditorSlotProps) => {
  return (
    <div
      id='device-editor-left-slot'
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

const DeviceEditorRightSlot = (props: DeviceEditorSlotProps) => {
  return (
    <div
      id='device-editor-right-slot'
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

const DeviceEditorTemplate = (props: DeviceEditorTemplateProps) => {
  return (
    <div id='device-editor-template' className='flex h-full w-full overflow-hidden' {...props}>
      {props.children}
    </div>
  )
}
export { DeviceEditorLeftSlot, DeviceEditorRightSlot, DeviceEditorTemplate }
