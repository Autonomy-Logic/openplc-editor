import * as Popover from '@radix-ui/react-popover'
import { PlusIcon } from '@root/renderer/assets'
import _ from 'lodash'
import { useState } from 'react'

import { Card } from './card'

const CreatePou = () => {
  const [isContainerOpen, setIsContainerOpen] = useState(false)
  const CreatePouTypes: ('function' | 'function-block' | 'program')[] = ['function', 'function-block', 'program']

  return (
    <Popover.Root onOpenChange={setIsContainerOpen} open={isContainerOpen}>
      <Popover.Trigger
        id='create-pou-trigger'
        type='button'
        className='w-10 h-8 rounded-lg bg-brand flex justify-center items-center'
        onClick={() => setIsContainerOpen((prev) => !prev)}
      >
        <PlusIcon className='stroke-white' />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          alignOffset={-7}
          sideOffset={10}
          align='end'
          className='w-[188px] h-fit shadow-card dark:shadow-dark-card border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-lg flex flex-col gap-2'
        >
          {CreatePouTypes.map((target) => (
            <Card key={`unique ${target}`} target={target} closeContainer={setIsContainerOpen} />
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export { CreatePou }
