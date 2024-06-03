import * as Popover from '@radix-ui/react-popover'
import { PlusIcon } from '@root/renderer/assets'
import { useState } from 'react'

import { ElementCard } from './element-card'

const CreatePLCElement = () => {
  const [isContainerOpen, setIsContainerOpen] = useState(false)
  const CreatePLCElementTypes: ('function' | 'function-block' | 'program' | 'data-type')[] = [
    'function',
    'function-block',
    'program',
    'data-type',
  ]

  return (
    <Popover.Root onOpenChange={setIsContainerOpen} open={isContainerOpen}>
      <Popover.Trigger
        id='create-plc-element-trigger'
        aria-label='Create PLC element trigger component'
        type='button'
        className='flex h-8 w-10 items-center justify-center rounded-lg bg-brand'
        onClick={() => setIsContainerOpen((prev) => !prev)}
      >
        <PlusIcon className='stroke-white' />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          alignOffset={-7}
          sideOffset={10}
          align='end'
          className='flex h-fit w-[188px] flex-col gap-2 rounded-lg border border-brand-light bg-white p-2 shadow-card dark:border-brand-medium-dark dark:bg-neutral-950 dark:shadow-dark-card'
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
