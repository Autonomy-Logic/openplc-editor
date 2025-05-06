import {
  DeviceEditorLeftSlot,
  DeviceEditorRightSlot,
  DeviceEditorTemplate,
} from '@root/renderer/components/_templates/[editors]/device-editor-template'
const PinMappingEditor = () => {
  return (
    <DeviceEditorTemplate>
      <DeviceEditorLeftSlot heading='Board Configuration'></DeviceEditorLeftSlot>
      <hr id='screen-split' className='h-[99%] w-[1px] self-stretch bg-brand-light' />
      <DeviceEditorRightSlot heading='Communication'></DeviceEditorRightSlot>
    </DeviceEditorTemplate>
  )
}

export { PinMappingEditor }
