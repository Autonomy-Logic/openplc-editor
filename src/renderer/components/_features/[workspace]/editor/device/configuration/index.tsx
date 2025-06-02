import { DeviceEditorTemplate } from '@root/renderer/components/_templates/[editors]'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect } from 'react'

import { Board } from './board'
import { Communication } from './communication'

const DeviceConfigurationEditor = () => {
  const {
    deviceActions: { addPin },
    deviceDefinitions: {
    pinMapping
    },
  } = useOpenPLCStore()
  
  console.log("🚀 ~ DeviceConfigurationEditor ~ pinMapping:", pinMapping)
  useEffect(() => {
    addPin({
      pinType: 'digitalInput',
      pinToAdd: {
        pin: 'dxe',
        address: '%QX0.0',
        name: 'firstPin',
      },
    })
    addPin({
      pinType: 'analogInput',
      pinToAdd: {
        pin: 'axe',
        address: '%QW0',
        name: 'secondPin',
      },
    })
  }, [])

  

  return (
    <DeviceEditorTemplate id='device-configuration-editor'>
      <Board />
      <hr id='screen-split' className='mx-2 h-[99%] w-[1px] self-stretch bg-brand-light' />
      <Communication />
    </DeviceEditorTemplate>
  )
}

export { DeviceConfigurationEditor }
