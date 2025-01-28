import { ConfigurationEditor } from '@root/renderer/components/_organisms/configuration-editor'
import { PinMappingEditor } from '@root/renderer/components/_organisms/pin-mapping-editor'
import { ComponentPropsWithoutRef } from 'react'

type DeviceEditorProps = ComponentPropsWithoutRef<'div'> & {
  DeviceTypeName: string
}

const DeviceEditor = ({ DeviceTypeName }: DeviceEditorProps) => {
  console.log('DeviceTypeName', DeviceTypeName)
  return (
    <div aria-label='Data type content container' className='h-full w-full overflow-hidden'>
      {DeviceTypeName === 'Pin Mapping' && <PinMappingEditor />}
      {DeviceTypeName === 'Configuration' && <ConfigurationEditor />}
    </div>
  )
}

export { DeviceEditor }
