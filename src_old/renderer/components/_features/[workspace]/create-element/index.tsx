import * as Popover from '@radix-ui/react-popover'
import { PlusIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { useState } from 'react'

import { ElementCard } from './element-card'

const CreatePLCElement = () => {
  const {
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()
  const [isContainerOpen, setIsContainerOpen] = useState(false)
  const CreatePLCElementTypes: (
    | 'function'
    | 'function-block'
    | 'program'
    | 'data-type'
    | 'server'
    | 'remote-device'
  )[] = ['function', 'function-block', 'program', 'data-type', 'server', 'remote-device']

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
