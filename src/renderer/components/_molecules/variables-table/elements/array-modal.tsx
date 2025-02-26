import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { Button, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@root/renderer/components/_molecules/modal'
import { useOpenPLCStore } from '@root/renderer/store'
import { arrayValidation } from '@root/renderer/store/slices/workspace/utils/variables'
import { BaseType, baseTypeSchema } from '@root/types/PLC/open-plc'
import { useEffect, useState } from 'react'

import { ArrayDimensionsInput } from './array-input'

type ArrayModalProps = {
  variableName: string
  VariableRow?: number
  arrayModalIsOpen: boolean
  setArrayModalIsOpen: (value: boolean) => void
  closeContainer: () => void
}

export const ArrayModal = ({
  arrayModalIsOpen,
  closeContainer,
  setArrayModalIsOpen,
  variableName,
  VariableRow,
}: ArrayModalProps) => {
  const {
    editor: {
      meta: { name },
    },
    project: {
      data: { dataTypes, pous },
    },
    projectActions: { updateVariable },
  } = useOpenPLCStore()

  const baseTypes = baseTypeSchema.options
  const allTypes = [
    ...baseTypes,
    ...dataTypes.map((type) => (type.name !== name ? type.name : '')).filter((type) => type !== ''),
  ]

  const [selectedInput, setSelectedInput] = useState<string>('')
  const [dimensions, setDimensions] = useState<string[]>([])
  const [typeValue, setTypeValue] = useState<string>('dint')

  useEffect(() => {
    const variable = pous
      .find((pou) => pou.data.name === name)
      ?.data.variables.find((variable) => variable.name === variableName)
    if (!variable) return

    if (variable.type.definition === 'array') {
      setDimensions(variable.type.data.dimensions.map((dimension) => dimension.dimension))
      setTypeValue(variable.type.data.baseType.value)
    } else {
      setDimensions([])
      setTypeValue('dint')
    }
  }, [name, variableName, pous])

  const handleAddDimension = () => {
    setDimensions((prev) => [...prev, ''])
    setSelectedInput(dimensions.length.toString())
  }

  const handleRemoveDimension = (index: string) => {
    setDimensions((prev) => [...prev.slice(0, Number(index)), ...prev.slice(Number(index) + 1)])
    setSelectedInput('')
  }

  const handleRearrangeDimensions = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up') {
      if (index === 0) return
      const [removed] = dimensions.splice(index, 1)
      dimensions.splice(index - 1, 0, removed)
      setSelectedInput((index - 1).toString())
      return
    }

    if (index === dimensions.length - 1) return
    const [removed] = dimensions.splice(index, 1)
    dimensions.splice(index + 1, 0, removed)
    setSelectedInput((index + 1).toString())
  }

  const handleUpdateType = (value: BaseType) => {
    setTypeValue(value)
  }

  const handleUpdateDimension = (index: number, value: string): { ok: boolean } => {
    const res = arrayValidation({ value: value })
    if (!res.ok) {
      toast({
        title: res.title,
        description: res.message,
        variant: 'fail',
      })
      return { ok: false }
    }
    setDimensions((prev) => [...prev.slice(0, index), value, ...prev.slice(index + 1)])
    return { ok: true }
  }

  const handleInputClick = (value: string) => {
    setSelectedInput(value)
  }

  const handleSave = () => {
    const dimensionToSave = dimensions.filter((value) => value !== '')
    if (dimensionToSave.length === 0) {
      toast({
        title: 'Invalid array',
        description: 'Array must have at least one not empty dimension',
        variant: 'fail',
      })
      return
    }
    const formatArrayName = `ARRAY [${dimensionToSave.join(', ')}] OF ${typeValue?.toUpperCase()}`

    let isBaseType = false
    baseTypes.forEach((type) => {
      if (type === typeValue) isBaseType = true
    })

    updateVariable({
      scope: 'local',
      associatedPou: name,
      rowId: VariableRow,
      data: {
        type: {
          definition: 'array',
          value: formatArrayName,
          data: {
            // @ts-expect-error - This is a valid operation. This is being fixed.
            baseType: {
              definition: isBaseType ? 'base-type' : 'user-data-type',
              value: typeValue,
            },
            dimensions: dimensionToSave.map((dimension) => ({ dimension: dimension })),
          },
        },
      },
    })
    setArrayModalIsOpen(false)
    closeContainer()
  }

  const handleCancel = () => {
    setArrayModalIsOpen(false)
    closeContainer()
  }

  return (
    <Modal onOpenChange={setArrayModalIsOpen} open={arrayModalIsOpen}>
      <ModalTrigger
        onClick={() => setArrayModalIsOpen(true)}
        className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'
      >
        <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>Array</span>
      </ModalTrigger>
      <ModalContent
        onEscapeKeyDown={handleCancel}
        onPointerDownOutside={handleCancel}
        onInteractOutside={handleCancel}
        onClose={handleCancel}
      >
        <ModalHeader>
          <ModalTitle>Array type definition</ModalTitle>
        </ModalHeader>
        <div aria-label='Array type definition modal content container' className='flex h-full w-full flex-col gap-2'>
          <div aria-label='Header container' className='flex h-fit w-full flex-col gap-2'>
            <div aria-label='Array base type container' className='flex h-fit w-full items-center justify-between'>
              <label className='cursor-default select-none pr-6 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-100'>
                Base type
              </label>
              <Select
                value={typeValue}
                onValueChange={(value) => handleUpdateType(value as BaseType)}
                aria-label='Array data type base type select'
              >
                <SelectTrigger
                  withIndicator
                  placeholder='Base type'
                  className='flex h-7 w-full max-w-44 items-center justify-between gap-2 rounded-lg border border-neutral-400 bg-white px-3 py-2 font-caption text-xs font-normal text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
                />
                <SelectContent
                  position='popper'
                  side='bottom'
                  sideOffset={-28}
                  className='box z-[999] max-h-[300px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg bg-white outline-none dark:bg-neutral-950'
                >
                  {allTypes.map((type) => (
                    <SelectItem
                      value={type}
                      className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    >
                      <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                        {type.toUpperCase()}
                      </span>
                    </SelectItem>
                  ))}
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
                <TableActionButton aria-label='Add table row button' onClick={() => handleAddDimension()}>
                  <PlusIcon className='!stroke-brand' />
                </TableActionButton>
                <TableActionButton
                  aria-label='Remove table row button'
                  onClick={() => handleRemoveDimension(selectedInput)}
                >
                  <MinusIcon />
                </TableActionButton>
                <TableActionButton
                  aria-label='Move table row up button'
                  onClick={() => handleRearrangeDimensions(Number(selectedInput), 'up')}
                >
                  <StickArrowIcon direction='up' />
                </TableActionButton>
                <TableActionButton
                  aria-label='Move table row down button'
                  onClick={() => handleRearrangeDimensions(Number(selectedInput), 'down')}
                >
                  <StickArrowIcon direction='down' />
                </TableActionButton>
              </div>
            </div>
          </div>
          <div
            aria-label='Array type table container'
            className='flex h-fit w-full flex-col *:border-x *:border-b *:border-neutral-300 [&>*:first-child]:rounded-t-lg [&>*:first-child]:border-t [&>*:last-child]:rounded-b-lg'
          >
            {dimensions.map((value, index) => (
              <ArrayDimensionsInput
                id={index.toString()}
                key={index}
                initialValue={value}
                selectedInput={selectedInput}
                handleInputClick={handleInputClick}
                handleUpdateDimension={handleUpdateDimension}
              />
            ))}
          </div>
        </div>
        <ModalFooter className='flex items-center justify-around'>
          <Button className='h-8 justify-center text-xs' onClick={() => handleSave()}>
            Save
          </Button>
          <Button
            onClick={() => handleCancel()}
            className='h-8 justify-center bg-neutral-100 text-xs text-neutral-1000 hover:bg-neutral-300 focus:bg-neutral-200'
          >
            Cancel
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
