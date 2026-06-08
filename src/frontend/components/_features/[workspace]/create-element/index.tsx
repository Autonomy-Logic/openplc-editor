import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'

import { projectCapabilities } from '../../../../../middleware/shared/ports/types'
import { PlusIcon } from '../../../../assets/icons/interface/Plus'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { ElementCard } from './element-card'

type CreatePLCElementType = 'function' | 'function-block' | 'program' | 'data-type' | 'server' | 'remote-device'

const CreatePLCElement = () => {
  const {
    workspace: { isDebuggerVisible },
    project: {
      meta: { type: projectType },
    },
  } = useOpenPLCStore()
  const [isContainerOpen, setIsContainerOpen] = useState(false)

  // Filter the picker by the current project's capability matrix.
  // Libraries only allow function / function-block / data-type —
  // programs / servers / remote devices are program-level
  // affordances that don't apply to a `.stlib` build.  Project-type
  // gating happens here so a future new POU type doesn't have to be
  // wired up in two places.
  const projectCaps = projectCapabilities({ type: projectType })
  const CreatePLCElementTypes: CreatePLCElementType[] = (
    ['function', 'function-block', 'program', 'data-type', 'server', 'remote-device'] as const
  ).filter((target) => {
    switch (target) {
      case 'program':
        return projectCaps.hasPrograms
      case 'server':
        return projectCaps.hasServers
      case 'remote-device':
        return projectCaps.hasRemoteDevices
      default:
        // function / function-block / data-type — always available.
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
          className='box flex h-fit w-[188px] flex-col gap-2 rounded-lg bg-white p-2 dark:bg-neutral-950'
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
