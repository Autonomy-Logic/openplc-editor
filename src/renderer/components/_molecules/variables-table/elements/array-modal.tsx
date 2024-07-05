import { MinusIcon, PencilIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { Button, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@root/renderer/components/_molecules/modal'
import { useOpenPLCStore } from '@root/renderer/store'

import { ArrayDimensionsComponent } from './array'

type ArrayModalProps = {
  variableName: string
  arrayModalIsOpen: boolean
  setArrayModalIsOpen: (value: boolean) => void
}

export const ArrayModal = ({ arrayModalIsOpen, setArrayModalIsOpen, variableName }: ArrayModalProps) => {
  const {
    editor: {
      meta: { name },
    },
    workspace: {
      projectData: { pous },
    },
  } = useOpenPLCStore()

  const variable = pous
    .find((pou) => pou.data.name === name)
    ?.data.variables.find((variable) => variable.name === variableName)
  const dimensions: string[] = variable?.type.definition === 'array' ? variable.type.value.dimensions : []

  return (
    <Modal onOpenChange={setArrayModalIsOpen} open={arrayModalIsOpen}>
      <ModalTrigger
        onClick={() => setArrayModalIsOpen(true)}
        className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'
      >
        <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>Array</span>
      </ModalTrigger>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Array type definition</ModalTitle>
        </ModalHeader>
        <div aria-label='Array type definition modal content container' className='flex h-full w-full flex-col gap-2'>
          <div aria-label='Header container' className='flex h-fit w-full flex-col gap-2'>
            <div aria-label='Array base type container' className='flex h-fit w-full items-center justify-between'>
              <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
                Base type
              </label>
              <Select aria-label='Array data type base type select'>
                <SelectTrigger
                  withIndicator
                  placeholder='Base type'
                  className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
                />
                <SelectContent
                  position='popper'
                  side='bottom'
                  sideOffset={-28}
                  className='box z-[999] h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                >
                  <SelectItem
                    value='Option 1'
                    className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  >
                    <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                      Option 1
                    </span>
                  </SelectItem>
                  <SelectItem
                    value='Option 2'
                    className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  >
                    <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                      Option 2
                    </span>
                  </SelectItem>
                  <SelectItem
                    value='Option 3'
                    className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  >
                    <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                      Option 3
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div
              aria-label='Array type table actions container'
              className='flex h-fit w-full items-center justify-between'
            >
              <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
                Dimensions
              </p>
              <div
                aria-label='Data type table actions buttons container'
                className='flex h-full w-fit items-center justify-evenly *:rounded-md *:p-1'
              >
                <div
                  aria-label='Add table row button'
                  className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  onClick={() => console.log('Button clicked')}
                >
                  <PencilIcon className='!stroke-brand' />
                </div>
                <div
                  aria-label='Add table row button'
                  className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  onClick={() => console.log('Button clicked')}
                >
                  <PlusIcon className='!stroke-brand' />
                </div>
                <div
                  aria-label='Remove table row button'
                  className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  onClick={() => console.log('Button clicked')}
                >
                  <MinusIcon />
                </div>
                <div
                  aria-label='Move table row up button'
                  className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  onClick={() => console.log('Button clicked')}
                >
                  <StickArrowIcon direction='up' />
                </div>
                <div
                  aria-label='Move table row down button'
                  className='hover:cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  onClick={() => console.log('Button clicked')}
                >
                  <StickArrowIcon direction='down' />
                </div>
              </div>
            </div>
          </div>
          <ArrayDimensionsComponent values={dimensions} />
        </div>
        <ModalFooter className='flex items-center justify-around'>
          <Button className='h-8 justify-center text-xs' onClick={() => setArrayModalIsOpen(false)}>
            Save
          </Button>
          <Button
            onClick={() => setArrayModalIsOpen(false)}
            className='h-8 justify-center bg-neutral-100 text-xs text-neutral-1000 hover:bg-neutral-300 focus:bg-neutral-200'
          >
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
