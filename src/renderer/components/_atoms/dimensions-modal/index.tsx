import { ScrollArea } from '@radix-ui/react-scroll-area'
import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { Button, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@root/renderer/components/_molecules/modal'
import { BaseType } from '@root/types/PLC/open-plc'

import TableActions from '../table-actions'
import { ArrayDimensionsInput } from './array-dimensions-input'

interface DimensionsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onSave: () => void
  typeValue: string
  allTypes: string[]
  onTypeChange: (value: BaseType) => void
  dimensions: string[]
  selectedInput: string
  onAddDimension: () => void
  onRemoveDimension: (id: string) => void
  onRearrangeDimensions: (index: number, direction: 'up' | 'down') => void
  onInputClick: (id: string) => void
  onUpdateDimension: (index: number, value: string) => { ok: boolean }
}

export const DimensionsModal = ({
  open,
  onOpenChange,
  onCancel,
  onSave,
  typeValue,
  allTypes,
  onTypeChange,
  dimensions,
  selectedInput,
  onAddDimension,
  onRemoveDimension,
  onRearrangeDimensions,
  onInputClick,
  onUpdateDimension,
}: DimensionsModalProps) => {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalTrigger
        onClick={() => onOpenChange(true)}
        className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'
      >
        <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>Array</span>
      </ModalTrigger>
      <ModalContent
        onEscapeKeyDown={onCancel}
        onPointerDownOutside={onCancel}
        onInteractOutside={onCancel}
        onClose={onCancel}
      >
        <ModalHeader>
          <ModalTitle>Array type definition</ModalTitle>
        </ModalHeader>

        <div className='flex h-full w-full flex-col gap-2' aria-label='Array type definition modal content container'>
          <div className='flex h-fit w-full flex-col gap-2' aria-label='Header container'>
            <div className='flex h-fit w-full items-center justify-between' aria-label='Array base type container'>
              <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
                Base type
              </label>
              <Select value={typeValue} onValueChange={onTypeChange} aria-label='Array data type base type select'>
                <SelectTrigger
                  withIndicator
                  placeholder='Base type'
                  className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
                />
                <SelectContent
                  position='popper'
                  side='bottom'
                  sideOffset={-28}
                  className='box z-[999] max-h-[300px] w-[--radix-select-trigger-width] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                >
                  <ScrollArea className='max-h-[300px] overflow-y-auto'>
                    {allTypes.map((type) => (
                      <SelectItem
                        key={type}
                        value={type}
                        className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                      >
                        <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                          {type.toUpperCase()}
                        </span>
                      </SelectItem>
                    ))}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>

            <div
              className='flex h-fit w-full items-center justify-between'
              aria-label='Array type table actions container'
            >
              <p className='cursor-default select-none font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
                Dimensions
              </p>
              <div
                className='flex h-full w-fit items-center justify-evenly *:rounded-md *:p-1'
                aria-label='Data type table actions buttons container'
              >
                <TableActions
                  actions={[
                    {
                      ariaLabel: 'Add table row button',
                      onClick: onAddDimension,
                      icon: <PlusIcon className='!stroke-brand' />,
                      id: 'add-new-row-button',
                    },
                    {
                      ariaLabel: 'Remove table row button',
                      onClick: () => onRemoveDimension(selectedInput),
                      icon: <MinusIcon className='stroke-[#0464FB]' />,
                    },
                    {
                      ariaLabel: 'Move table row up button',
                      onClick: () => onRearrangeDimensions(Number(selectedInput), 'up'),
                      icon: <StickArrowIcon direction='up' className='stroke-[#0464FB]' />,
                    },
                    {
                      ariaLabel: 'Move table row down button',
                      onClick: () => onRearrangeDimensions(Number(selectedInput), 'down'),
                      icon: <StickArrowIcon direction='down' className='stroke-[#0464FB]' />,
                    },
                  ]}
                />
              </div>
            </div>
          </div>

          <div
            className='flex h-fit w-full flex-col *:border-x *:border-b *:border-neutral-300 [&>*:first-child]:rounded-t-lg [&>*:first-child]:border-t [&>*:last-child]:rounded-b-lg'
            aria-label='Array type table container'
          >
            {dimensions.map((value, index) => (
              <ArrayDimensionsInput
                key={index}
                id={index.toString()}
                initialValue={value}
                selectedInput={selectedInput}
                handleInputClick={onInputClick}
                handleUpdateDimension={onUpdateDimension}
              />
            ))}
          </div>
        </div>

        <ModalFooter className='flex items-center justify-between gap-4'>
          <Button className='h-8 w-full justify-center text-xs' onClick={onSave}>
            Save
          </Button>
          <Button
            onClick={onCancel}
            className='h-8 w-full justify-center bg-neutral-100 text-xs text-neutral-1000 hover:bg-neutral-300 focus:bg-neutral-200'
          >
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
