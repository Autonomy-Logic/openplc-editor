import { ComponentPropsWithoutRef } from 'react'

type DeviceEditorTemplateProps = ComponentPropsWithoutRef<'div'>

const DeviceEditorTemplate = (props: DeviceEditorTemplateProps) => {
  return (
    <div id='device-editor-template' className='flex h-full w-full overflow-hidden' {...props}>
      {props.children}
    </div>
  )
}
export { DeviceEditorTemplate }
