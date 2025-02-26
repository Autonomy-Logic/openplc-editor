import { ConfigurationEditor } from '@root/renderer/components/_organisms/configuration-editor'
import { PinMappingEditor } from '@root/renderer/components/_organisms/pin-mapping-editor'
import { ComponentPropsWithoutRef } from 'react'

enum DeviceType {
  PIN_MAPPING = 'Pin Mapping',
  CONFIGURATION = 'Configuration',
}
type DeviceEditorProps = ComponentPropsWithoutRef<'div'> & {
  DeviceTypeName: DeviceType
}

const DeviceEditor = ({ DeviceTypeName }: DeviceEditorProps) => {
  return (
    <div aria-label='Device content container' className='h-full w-full overflow-hidden'>
      {DeviceTypeName === DeviceType.PIN_MAPPING && <PinMappingEditor />}
      {DeviceTypeName === DeviceType.CONFIGURATION && <ConfigurationEditor />}
    </div>
  )
}

export { DeviceEditor }
