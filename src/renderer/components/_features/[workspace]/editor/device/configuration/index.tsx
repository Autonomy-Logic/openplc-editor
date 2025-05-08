import { DeviceEditorTemplate } from '@root/renderer/components/_templates/[editors]'

import { Board, Communication } from '../elements'

const DeviceConfigurationEditor = () => {
  return (
    <DeviceEditorTemplate id='device-configuration-editor'>
      <Board />
      <hr id='screen-split' className='mx-2 h-[99%] w-[1px] self-stretch bg-brand-light' />
      <Communication />
    </DeviceEditorTemplate>
  )
}
export { DeviceConfigurationEditor }
