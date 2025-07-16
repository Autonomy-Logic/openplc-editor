import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { Button } from '@root/renderer/components/_atoms'
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
import { TypeDropdownSelector } from '../type-dropdown-selector'
import { ArrayDimensionsInput } from './array-dimensions-input'

interface DimensionsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onSave: () => void
  typeValue: string
  variableTypes: { definition: string; values: string[] }[]
  libraryTypes: { definition: string; values: string[] }[]
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
  onTypeChange,
  dimensions,
  selectedInput,
  onAddDimension,
  onRemoveDimension,
  onRearrangeDimensions,
  onInputClick,
  onUpdateDimension,
  libraryTypes,
  variableTypes,
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

              <TypeDropdownSelector
                value={typeValue}
                onSelect={(_definition, value) => onTypeChange(value as BaseType)}
                variableTypes={variableTypes}
                libraryTypes={libraryTypes}
              />
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
