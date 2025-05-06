import { ComponentPropsWithoutRef } from 'react'

type DeviceEditorTemplateProps = ComponentPropsWithoutRef<'div'>

const _DeviceEditorLeftSlot = (props: ComponentPropsWithoutRef<'div'>) => {
  return <div {...props}>{props.children}</div>
}

const _DeviceEditorRightSlot = (props: ComponentPropsWithoutRef<'div'>) => {
  return <div {...props}>{props.children}</div>
}

const DeviceEditorTemplate = (props: DeviceEditorTemplateProps) => {
  return (
    <div id='device-editor-template' {...props}>
      {props.children}
    </div>
  )
}
export { DeviceEditorTemplate }
