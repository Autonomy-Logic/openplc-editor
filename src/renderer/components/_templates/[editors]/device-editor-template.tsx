import { ComponentPropsWithoutRef } from 'react'

type DeviceEditorTemplateProps = ComponentPropsWithoutRef<'div'>
const DeviceEditorTemplate = (props: DeviceEditorTemplateProps) => {
  return <div {...props}>{props.children}</div>
}
export { DeviceEditorTemplate }
