import { ComponentPropsWithoutRef } from 'react'

import { ConfigurationEditor, PinMappingEditor } from './components'

type DeviceType = 'Pin Mapping' | 'Configuration'

type DeviceEditorProps = ComponentPropsWithoutRef<'div'> & {
  DeviceTypeName: DeviceType
}

const DeviceEditor = ({ DeviceTypeName }: DeviceEditorProps) => {
  return (
    <div aria-label='Device content container' className='h-full w-full overflow-hidden'>
      {DeviceTypeName === 'Pin Mapping' ? <PinMappingEditor /> : <ConfigurationEditor />}
    </div>
  )
}

export { DeviceEditor }
