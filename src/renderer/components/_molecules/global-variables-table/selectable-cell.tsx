import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { ArrowIcon, DebuggerIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import {
  TypeChangeValidationResult,
  validateTypeChange,
} from '@root/renderer/store/slices/project/validation/type-change'
import { propagateVariableTypeChange } from '@root/renderer/utils/variable-references'
import type { PLCGlobalVariable, PLCVariable } from '@root/types/PLC/open-plc'
import { baseTypeSchema } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import { TypeChangeModal } from '../type-change-modal'
import { GlobalArrayModal } from './elements/array-modal'

type ISelectableCellProps = CellContext<PLCVariable, unknown> & { editable?: boolean }

const createVariableType = (
  definition: PLCVariable['type']['definition'],
  value: string,
): PLCVariable['type'] | null => {
  switch (definition) {
    case 'base-type':
      return {
        definition: 'base-type',
        value: value as Extract<PLCVariable['type'], { definition: 'base-type' }>['value'],
      }
    case 'user-data-type':
      return { definition: 'user-data-type', value }
    case 'derived':
      return { definition: 'derived', value }
    case 'array':
      return null
    default:
      return null
  }
}

const SelectableTypeCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const {
    project: {
      data: { dataTypes, pous },
    },
    ladderFlows,
    fbdFlows,
    projectActions: { updateVariable },
    libraries: sliceLibraries,
  } = useOpenPLCStore()

  const VariableTypes = [
    {
      definition: 'base-type',
      values: baseTypeSchema.options,
    },
    { definition: 'user-data-type', values: dataTypes.map((dataType) => dataType.name) },
  ]

  const LibraryTypes = [
    {
      definition: 'system',
      values: sliceLibraries.system.flatMap((library) =>
        library.pous.filter((pou) => pou.type === 'function-block').map((pou) => pou.name.toUpperCase()),
      ),
    },
    {
      definition: 'user',
      values: sliceLibraries.user.flatMap((userLibrary) =>
        'pous' in userLibrary && Array.isArray((userLibrary as { pous: { type: string; name: string }[] }).pous)
          ? (userLibrary as { pous: { type: string; name: string }[] }).pous
              .filter((pou) => pou.type === 'function-block')
              .map((pou) => pou.name.toUpperCase())
          : userLibrary.type === 'function-block'
            ? [userLibrary.name.toUpperCase()]
            : [],
      ),
    },
  ]

  const { value, definition } = getValue<PLCGlobalVariable['type']>()
  const [cellValue, setCellValue] = useState<PLCGlobalVariable['type']['value']>(value)

  const [poppoverIsOpen, setPoppoverIsOpen] = useState(false)
  const [arrayModalIsOpen, setArrayModalIsOpen] = useState(false)
  const [typeChangeModalOpen, setTypeChangeModalOpen] = useState(false)
  const [pendingTypeChange, setPendingTypeChange] = useState<{
    definition: PLCVariable['type']['definition']
    value: PLCVariable['type']['value']
  } | null>(null)
  const [validationResult, setValidationResult] = useState<TypeChangeValidationResult | null>(null)

  const [variableFilters, setVariableFilters] = useState<Record<string, string>>({
    'base-type': '',
    'user-data-type': '',
  })
  const [libraryFilter, setLibraryFilter] = useState('')

  const filteredBaseTypes =
    VariableTypes.find((v) => v.definition === 'base-type')?.values.filter((val) =>
      val.toUpperCase().includes(variableFilters['base-type'].toUpperCase()),
    ) || []

  const filteredUserDataTypes =
    VariableTypes.find((v) => v.definition === 'user-data-type')?.values.filter((val) =>
      val.toUpperCase().includes(variableFilters['user-data-type'].toUpperCase()),
    ) || []

  const filteredSystemLibraries =
    LibraryTypes.find((l) => l.definition === 'system')?.values.filter((val) =>
      val.toUpperCase().includes(libraryFilter.toUpperCase()),
    ) || []

  const filteredUserLibraries =
    LibraryTypes.find((l) => l.definition === 'user')?.values.filter((val) =>
      val.toUpperCase().includes(libraryFilter.toUpperCase()),
    ) || []

  const currentVariable = table.options.data[index]
  const variableName = currentVariable.name

  const applyTypeChange = (definition: PLCVariable['type']['definition'], value: PLCVariable['type']['value']) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, { definition, value })

    const newType = createVariableType(definition, value)
    if (newType) {
      propagateVariableTypeChange(variableName, newType, pous, { updateVariable })
    }
  }

  const onSelect = (definition: PLCGlobalVariable['type']['definition'], value: PLCGlobalVariable['type']['value']) => {
    const oldType = currentVariable.type

    if (oldType.value === value && oldType.definition === definition) {
      return
    }

    const newType = createVariableType(definition, value)

    if (!newType) {
      applyTypeChange(definition, value)
      return
    }

    const validation = validateTypeChange(variableName, oldType, newType, ladderFlows, fbdFlows, 'global', pous)

    if (validation.affectedNodes.length > 0 || validation.warnings.length > 0) {
      setPendingTypeChange({ definition, value })
      setValidationResult(validation)
      setTypeChangeModalOpen(true)
      setPoppoverIsOpen(false)
      return
    }

    applyTypeChange(definition, value)
  }

  const handleTypeChangeConfirm = () => {
    if (pendingTypeChange) {
      applyTypeChange(pendingTypeChange.definition, pendingTypeChange.value)
    }
    setTypeChangeModalOpen(false)
    setPendingTypeChange(null)
    setValidationResult(null)
  }

  const handleTypeChangeCancel = () => {
    setTypeChangeModalOpen(false)
    setPendingTypeChange(null)
    setValidationResult(null)
  }

  useEffect(() => {
    setCellValue(value)
  }, [value])

  return (
    <>
      {validationResult &&
        pendingTypeChange &&
        (() => {
          const newType = createVariableType(pendingTypeChange.definition, pendingTypeChange.value)
          if (!newType) return null
          return (
            <TypeChangeModal
              open={typeChangeModalOpen}
              variableName={variableName}
              oldType={currentVariable.type}
              newType={newType}
              validation={validationResult}
              onConfirm={handleTypeChangeConfirm}
              onCancel={handleTypeChangeCancel}
            />
          )
        })()}
      <GlobalArrayModal
        variableName={variableName}
        variableRow={index}
        arrayModalIsOpen={arrayModalIsOpen}
        setArrayModalIsOpen={setArrayModalIsOpen}
        closeContainer={() => setPoppoverIsOpen(false)}
      />
      <PrimitiveDropdown.Root onOpenChange={setPoppoverIsOpen} open={poppoverIsOpen}>
        <PrimitiveDropdown.Trigger asChild>
          <div
            className={cn('flex h-full w-full cursor-pointer justify-center p-2 outline-none', {
              'pointer-events-none': !editable,
            })}
          >
            <span className='line-clamp-1 font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {cellValue === null
                ? ''
                : definition === 'array' || definition === 'derived'
                  ? cellValue
                  : _.upperCase(cellValue as unknown as string)}
            </span>
          </div>
        </PrimitiveDropdown.Trigger>
        <PrimitiveDropdown.Portal>
          <PrimitiveDropdown.Content
            side='bottom'
            sideOffset={-20}
            className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
          >
            {VariableTypes.map((scope) => {
              const filterText = variableFilters[scope.definition] || ''
              const filteredValues = scope.definition === 'base-type' ? filteredBaseTypes : filteredUserDataTypes
              return (
                <PrimitiveDropdown.Sub
                  key={scope.definition}
                  onOpenChange={() => setVariableFilters((prev) => ({ ...prev, [scope.definition]: '' }))}
                >
                  <PrimitiveDropdown.SubTrigger asChild>
                    <div className='relative flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'>
                      <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                        {_.startCase(scope.definition)}
                      </span>
                      <ArrowIcon size='md' direction='right' className='absolute right-1' />
                    </div>
                  </PrimitiveDropdown.SubTrigger>
                  <PrimitiveDropdown.Portal>
                    <PrimitiveDropdown.SubContent
                      sideOffset={5}
                      className='box h-fit max-h-[300px] w-[200px] overflow-y-auto rounded-lg bg-white outline-none dark:bg-neutral-950'
                    >
                      <div className='sticky top-0 z-10 bg-white p-2 dark:bg-neutral-950'>
                        <InputWithRef
                          type='text'
                          placeholder='Search...'
                          className='w-full rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500'
                          value={filterText}
                          onChange={(e) =>
                            setVariableFilters((prev) => ({
                              ...prev,
                              [scope.definition]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </div>
                      {filteredValues.length > 0 ? (
                        filteredValues.map((value) => (
                          <PrimitiveDropdown.Item
                            key={value}
                            onSelect={() =>
                              onSelect(scope.definition as PLCGlobalVariable['type']['definition'], value)
                            }
                            className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                          >
                            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                              {_.upperCase(value)}
                            </span>
                          </PrimitiveDropdown.Item>
                        ))
                      ) : (
                        <div className='flex h-8 w-full items-center justify-center py-1'>
                          <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                            No {_.startCase(scope.definition)} found
                          </span>
                        </div>
                      )}
                    </PrimitiveDropdown.SubContent>
                  </PrimitiveDropdown.Portal>
                </PrimitiveDropdown.Sub>
              )
            })}

            <PrimitiveDropdown.Item
              onSelect={() => {
                setArrayModalIsOpen(true)
                setPoppoverIsOpen(false)
              }}
              className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 data-[state=open]:dark:bg-neutral-900'
            >
              <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>Array</span>
            </PrimitiveDropdown.Item>

            {LibraryTypes.map((scope) => {
              const filteredValues = scope.definition === 'system' ? filteredSystemLibraries : filteredUserLibraries
              return (
                <PrimitiveDropdown.Sub key={scope.definition} onOpenChange={() => setLibraryFilter('')}>
                  <PrimitiveDropdown.SubTrigger asChild>
                    <div className='relative flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'>
                      <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                        {_.startCase(scope.definition)}
                      </span>
                      <ArrowIcon size='md' direction='right' className='absolute right-1' />
                    </div>
                  </PrimitiveDropdown.SubTrigger>
                  <PrimitiveDropdown.Portal>
                    <PrimitiveDropdown.SubContent
                      sideOffset={5}
                      className='box h-fit max-h-[300px] w-[200px] overflow-y-auto rounded-lg bg-white outline-none dark:bg-neutral-950'
                    >
                      <div className='sticky top-0 z-10 bg-white p-2 dark:bg-neutral-950'>
                        <InputWithRef
                          type='text'
                          placeholder='Search...'
                          className='w-full rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500'
                          value={libraryFilter}
                          onChange={(e) => setLibraryFilter(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </div>
                      {filteredValues.length > 0 ? (
                        filteredValues.map((value) => (
                          <PrimitiveDropdown.Item
                            key={value}
                            onSelect={() => onSelect('derived', value)}
                            className='flex h-8 w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                          >
                            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                              {_.upperCase(value)}
                            </span>
                          </PrimitiveDropdown.Item>
                        ))
                      ) : (
                        <div className='flex h-8 w-full items-center justify-center py-1'>
                          <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                            No {_.startCase(scope.definition)} found
                          </span>
                        </div>
                      )}
                    </PrimitiveDropdown.SubContent>
                  </PrimitiveDropdown.Portal>
                </PrimitiveDropdown.Sub>
              )
            })}
          </PrimitiveDropdown.Content>
        </PrimitiveDropdown.Portal>
      </PrimitiveDropdown.Root>
    </>
  )
}
const VariableClasses = ['input', 'output', 'inOut', 'external', 'local', 'temp']

const SelectableClassCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: ISelectableCellProps) => {
  const initialValue = getValue()

  const [cellValue, setCellValue] = useState(initialValue)

  const onValueChange = (value: string) => {
    setCellValue(value)
    table.options.meta?.updateData(index, id, value)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <Select value={cellValue as string} onValueChange={(value) => onValueChange(value)}>
      <SelectTrigger
        placeholder={cellValue as string}
        className={cn(
          'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
          { 'pointer-events-none': !editable },
        )}
      />
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
      >
        {VariableClasses.map((type) => (
          <SelectItem
            key={type}
            value={type}
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {_.startCase(type)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const SelectableDebugCell = ({ getValue, row: { index }, column: { id }, table }: ISelectableCellProps) => {
  const initialValue = getValue<boolean | undefined>() ?? false

  const [cellValue, setCellValue] = useState(initialValue)

  const onClick = () => {
    const newValue = !cellValue
    setCellValue(newValue)
    table.options.meta?.updateData(index, id, newValue)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <button className='flex h-full w-full cursor-pointer items-center justify-center' onClick={onClick}>
      <DebuggerIcon variant={cellValue ? 'default' : 'muted'} />
    </button>
  )
}

export { SelectableClassCell, SelectableDebugCell, SelectableTypeCell }
