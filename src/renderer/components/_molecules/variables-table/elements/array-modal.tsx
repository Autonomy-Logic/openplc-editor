import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { Button, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { VariablesTableButton } from '@root/renderer/components/_atoms/buttons/variables-table'
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
import { BaseType, baseTypeSchema, PLCVariable } from '@root/types/PLC/open-plc'
import { useEffect, useState } from 'react'

import { ArrayDimensionsInput } from './array-input'

type ArrayModalProps = {
  variableName: string
  VariableRow?: number
  arrayModalIsOpen: boolean
  setArrayModalIsOpen: (value: boolean) => void
}

export const ArrayModal = ({ arrayModalIsOpen, setArrayModalIsOpen, variableName, VariableRow }: ArrayModalProps) => {
  const {
    editor: {
      meta: { name },
    },
    workspace: {
      projectData: { pous },
    },
    workspaceActions: { updateVariable },
  } = useOpenPLCStore()

  const types = baseTypeSchema.options

  const [oldTypeValue, setOldTypeValue] = useState<PLCVariable['type']>()
  const [dimensions, setDimensions] = useState<string[]>([])
  const [typeValue, setTypeValue] = useState<BaseType>('dint')
  const [selectedInput, setSelectedInput] = useState<string>('')

  useEffect(() => {
    const variable = pous
      .find((pou) => pou.data.name === name)
      ?.data.variables.find((variable) => variable.name === variableName)
    if (variable && !oldTypeValue) setOldTypeValue(variable?.type)

    if (variable?.type.definition === 'array') {
      setDimensions(variable.type.data.dimensions)
      setTypeValue(variable?.type.data.baseType)
    } else {
      setDimensions([])
      setTypeValue('dint')
    }
  }, [name, variableName, pous])

  const updatePouVariable = ({ dimensions, baseType }: { dimensions: string[]; baseType: BaseType }) => {
    const formatArrayName = `ARRAY [${dimensions.filter((value) => value !== '').join(',')}] OF ${typeValue?.toUpperCase() ?? 'DINT'}`
    const res = updateVariable({
      scope: 'local',
      associatedPou: name,
      rowId: VariableRow ?? 0,
      data: {
        type: {
          definition: 'array',
          value: formatArrayName,
          data: {
            baseType: baseType ?? 'dint',
            dimensions,
          },
        },
      },
    })
    if (!res.ok) {
      toast({
        title: res.title,
        description: res.message,
        variant: 'fail',
      })
      return false
    }
    return true
  }

  const handleAddDimension = () => {
    const draft = [...dimensions]
    draft.push('')
    updatePouVariable({ dimensions: draft, baseType: typeValue })
    setSelectedInput(dimensions.length.toString())
  }

  const handleRemoveDimension = (index: string) => {
    if (selectedInput === '') return
    const draft = [...dimensions]
    draft.splice(Number(index), 1)
    updatePouVariable({ dimensions: draft, baseType: typeValue })
    setSelectedInput('')
  }

  const handleInputClick = (value: string) => {
    setSelectedInput(value)
  }

  const handleRearrangeDimensions = (index: number, direction: 'up' | 'down') => {
    const draft = [...dimensions]
    if (selectedInput === '') return
    if (direction === 'up') {
      if (index === 0) return
      const temp = draft[index - 1]
      draft[index - 1] = draft[index]
      draft[index] = temp
      setSelectedInput((index - 1).toString())
    } else {
      if (index === dimensions.length - 1) return
      const temp = draft[index + 1]
      draft[index + 1] = draft[index]
      draft[index] = temp
      setSelectedInput((index + 1).toString())
    }
    updatePouVariable({ dimensions: draft, baseType: typeValue })
  }

  const handleUpdateType = (value: BaseType) => {
    updatePouVariable({ dimensions, baseType: value })
  }

  const handleUpdateDimension = (index: number, value: string): { ok: boolean } => {
    if (selectedInput === '') return { ok: false }
    const draft = [...dimensions]
    draft[index] = value
    const res = updatePouVariable({ dimensions: draft, baseType: typeValue })
    return { ok: res }
  }

  const handleSave = () => {
    updatePouVariable({ dimensions, baseType: typeValue })
    setArrayModalIsOpen(false)
  }

  const handleCancel = () => {
    updateVariable({
      scope: 'local',
      associatedPou: name,
      rowId: VariableRow ?? 0,
      data: {
        type: oldTypeValue,
      },
    })
    setArrayModalIsOpen(false)
  }

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
                  className='box z-[999] h-fit w-[--radix-select-trigger-width] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
                >
                  {types.map((type) => (
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
                <VariablesTableButton aria-label='Add table row button' onClick={() => handleAddDimension()}>
                  <PlusIcon className='!stroke-brand' />
                </VariablesTableButton>
                <VariablesTableButton
                  aria-label='Remove table row button'
                  onClick={() => handleRemoveDimension(selectedInput)}
                >
                  <MinusIcon />
                </VariablesTableButton>
                <VariablesTableButton
                  aria-label='Move table row up button'
                  onClick={() => handleRearrangeDimensions(Number(selectedInput), 'up')}
                >
                  <StickArrowIcon direction='up' />
                </VariablesTableButton>
                <VariablesTableButton
                  aria-label='Move table row down button'
                  onClick={() => handleRearrangeDimensions(Number(selectedInput), 'down')}
                >
                  <StickArrowIcon direction='down' />
                </VariablesTableButton>
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