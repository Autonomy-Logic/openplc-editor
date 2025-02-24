import { ConfigurationEditor } from '@root/renderer/components/_organisms/configuration-editor'
import { PinMappingEditor } from '@root/renderer/components/_organisms/pin-mapping-editor'
import { ComponentPropsWithoutRef } from 'react'

type DeviceEditorProps = ComponentPropsWithoutRef<'div'> & {
  DeviceTypeName: string
}

const DeviceEditor = ({ DeviceTypeName }: DeviceEditorProps) => {
  return (
    <div aria-label='Device content container' className='h-full w-full overflow-hidden'>
      {DeviceTypeName === 'Pin Mapping' && <PinMappingEditor />}
      {DeviceTypeName === 'Configuration' && <ConfigurationEditor />}
    </div>
  )
}

export { DeviceEditor }
