import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'

import { projectCapabilities } from '../../../../../middleware/shared/ports/types'
import { canHostModbusMaster } from '../../../../../middleware/shared/utils/modbus-master-profile'
import { PlusIcon } from '../../../../assets/icons/interface/Plus'
import { useModbusMasterProfile } from '../../../../hooks/use-modbus-master-profile'
import { useTargetCapabilities } from '../../../../hooks/use-target-capabilities'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { ElementCard } from './element-card'

type CreatePLCElementType =
  | 'function'
  | 'function-block'
  | 'program'
  | 'data-type'
  | 'global-variable-list'
  | 'server'
  | 'remote-device'

const CreatePLCElement = () => {
  const {
    workspace: { isDebuggerVisible },
    project: {
      meta: { type: projectType },
    },
  } = useOpenPLCStore()
  const [isContainerOpen, setIsContainerOpen] = useState(false)

  const projectCaps = projectCapabilities({ type: projectType })
  const targetCaps = useTargetCapabilities()
  const masterProfile = useModbusMasterProfile()
  const CreatePLCElementTypes: CreatePLCElementType[] = (
    ['function', 'function-block', 'program', 'data-type', 'global-variable-list', 'server', 'remote-device'] as const
  ).filter((target) => {
    switch (target) {
      case 'program':
        return projectCaps.hasPrograms
      case 'server':
        return projectCaps.hasServers
      case 'remote-device':
        return projectCaps.hasRemoteDevices && (canHostModbusMaster(masterProfile) || targetCaps.ethercat)
      default:
        return true
    }
  })

  return (
    <Popover.Root onOpenChange={setIsContainerOpen} open={isContainerOpen && !isDebuggerVisible}>
      <Popover.Trigger
        id='create-plc-element-trigger'
        aria-label='Create PLC element trigger component'
        type='button'
        disabled={isDebuggerVisible}
        className={cn('flex h-8 w-10 items-center justify-center rounded-lg bg-brand', {
          'cursor-not-allowed opacity-50': isDebuggerVisible,
        })}
      >
        <PlusIcon className='stroke-white' />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          alignOffset={-7}
          sideOffset={10}
          align='end'
          className='box flex h-fit w-[222px] flex-col gap-2 rounded-lg bg-white p-2 dark:bg-neutral-950'
        >
          {CreatePLCElementTypes.map((target) => (
            <ElementCard key={`unique ${target}`} target={target} closeContainer={setIsContainerOpen} />
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export { CreatePLCElement }
