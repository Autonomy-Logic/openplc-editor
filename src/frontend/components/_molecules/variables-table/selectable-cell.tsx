import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import type { CellContext } from '@tanstack/react-table'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { baseTypeEnum } from '../../../../middleware/shared/ports/plc-schemas'
import type { PLCVariable, VariableClass } from '../../../../middleware/shared/ports/types'
import { ArrowIcon } from '../../../assets/icons/interface/Arrow'
import { DebuggerIcon } from '../../../assets/icons/interface/Debugger'
import { useOpenPLCStore } from '../../../store'
import { TypeChangeValidationResult, validateTypeChange } from '../../../store/slices/project/validation/type-change'
import { cn } from '../../../utils/cn'
import { syncNodesWithVariables, syncNodesWithVariablesFBD } from '../../../utils/graphical/sync-nodes-with-variables'
import { PYTHON_UNSUPPORTED_CLASSES } from '../../../utils/python/block-interface'
import { hasStringName, safeUpper } from '../../../utils/safe-upper'
import { InputWithRef } from '../../_atoms/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms/select'
import { TypeChangeModal } from '../type-change-modal'
import { ArrayModal } from './elements/array-modal'

type ISelectableCellProps = CellContext<PLCVariable, unknown> & { selected?: boolean }

/** Declaration order shown in the Class dropdown. `global` is a
 *  configuration-level declaration, not a POU variable, so it is not here. */
const ALL_VARIABLE_CLASSES: readonly VariableClass[] = ['input', 'output', 'inOut', 'external', 'local', 'temp']

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
  selected = false,
}: ISelectableCellProps) => {
  const {
    editor,
    project: {
      data: { dataTypes },
    },
    ladderFlowActions: { updateNodes },
    fbdFlowActions: { updateNodes: updateFBDNodes },
    libraries: sliceLibraries,
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()

  const VariableTypes = [
    {
      definition: 'base-type',
      values: baseTypeEnum.options,
    },
    {
      definition: 'user-data-type',
      values: dataTypes.filter(hasStringName).map((dataType) => dataType.name),
    },
  ]

  const LibraryTypes = [
    {
      definition: 'system',
      values: sliceLibraries.system.flatMap((library) =>
        (library.pous ?? [])
          .filter((pou) => pou?.type === 'function-block')
          .filter(hasStringName)
          .map((pou) => pou.name.toUpperCase()),
      ),
    },
    {
      definition: 'user',
      values: sliceLibraries.user
        .filter(hasStringName)
        .filter((userLibrary) => userLibrary.name !== editor.meta.name)
        .flatMap((userLibrary) => {
          const pous = (userLibrary as { pous?: { type?: string; name?: string }[] }).pous
          if (Array.isArray(pous)) {
            return pous
              .filter((pou) => pou?.type === 'function-block')
              .filter(hasStringName)
              .map((pou) => pou.name.toUpperCase())
          }
          return userLibrary.type === 'function-block' ? [userLibrary.name.toUpperCase()] : []
        }),
    },
  ]

  // Every language offers the same types. Python and C++ blocks used to be
  // held to base types only, minus TIME/DATE/TOD/DT, because their bridges
  // could not carry anything else. Both now reach IEC parity — the time and
  // calendar types travel as 64-bit counts, arrays and user-defined types are
  // marshalled leaf by leaf, and a variable may be a function block instance —
  // so the table no longer has a reason to offer them less than the text
  // editor already accepts.
  const availableVariableTypes = VariableTypes
  const availableLibraryTypes = LibraryTypes

  const { value, definition } = getValue<PLCVariable['type']>()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState<PLCVariable['type']['value']>(value)
  const [arrayModalIsOpen, setArrayModalIsOpen] = useState(false)
  const [poppoverIsOpen, setPoppoverIsOpen] = useState(false)
  const [typeChangeModalOpen, setTypeChangeModalOpen] = useState(false)
  const [pendingTypeChange, setPendingTypeChange] = useState<{
    definition: PLCVariable['type']['definition']
    value: PLCVariable['type']['value']
  } | null>(null)
  const [validationResult, setValidationResult] = useState<TypeChangeValidationResult | null>(null)
  const variableName = table.options.data[index].name
  const currentVariable = table.options.data[index]

  const [variableFilters, setVariableFilters] = useState<Record<string, string>>({
    'base-type': '',
    'user-data-type': '',
  })
  const [libraryFilter, setLibraryFilter] = useState('')

  const filteredBaseTypes =
    availableVariableTypes
      .find((v) => v.definition === 'base-type')
      ?.values.filter((val) => safeUpper(val).includes(safeUpper(variableFilters['base-type']))) || []

  const filteredUserDataTypes =
    availableVariableTypes
      .find((v) => v.definition === 'user-data-type')
      ?.values.filter((val) => safeUpper(val).includes(safeUpper(variableFilters['user-data-type']))) || []

  const filteredSystemLibraries =
    availableLibraryTypes
      .find((l) => l.definition === 'system')
      ?.values.filter((val) => safeUpper(val).includes(safeUpper(libraryFilter))) || []

  const filteredUserLibraries =
    availableLibraryTypes
      .find((l) => l.definition === 'user')
      ?.values.filter((val) => safeUpper(val).includes(safeUpper(libraryFilter))) || []

  const applyTypeChange = (definition: PLCVariable['type']['definition'], value: PLCVariable['type']['value']) => {
    const language = 'language' in editor.meta ? editor.meta.language : undefined

    table.options.meta?.updateData(index, id, { definition, value })

    const {
      project: {
        data: { pous: freshPous },
      },
      ladderFlows: freshLadderFlows,
      fbdFlows: freshFBDFlows,
    } = useOpenPLCStore.getState()

    const pou = freshPous.find((p) => p.name === editor.meta.name)

    const newVars = pou?.interface?.variables ?? []

    if (language === 'fbd') {
      syncNodesWithVariablesFBD(newVars, freshFBDFlows, updateFBDNodes, editor.meta.name)
    }

    if (language === 'ld') {
      syncNodesWithVariables(newVars, freshLadderFlows, updateNodes, editor.meta.name)
    }

    setCellValue(value)
  }

  // When the input is blurred, we'll call our table meta's updateData function
  const onSelect = (definition: PLCVariable['type']['definition'], value: PLCVariable['type']['value']) => {
    const language = 'language' in editor.meta ? editor.meta.language : undefined

    const oldType = currentVariable.type

    if (oldType.value === value && oldType.definition === definition) {
      return
    }

    if (language === 'fbd' || language === 'ld') {
      const { ladderFlows: freshLadderFlows, fbdFlows: freshFBDFlows } = useOpenPLCStore.getState()

      const newType = createVariableType(definition, value)

      if (!newType) {
        applyTypeChange(definition, value)
        return
      }

      const validation = validateTypeChange(variableName, oldType, newType, freshLadderFlows, freshFBDFlows)

      if (validation.affectedNodes.length > 0 || validation.warnings.length > 0) {
        setPendingTypeChange({ definition, value })
        setValidationResult(validation)
        setTypeChangeModalOpen(true)
        setPoppoverIsOpen(false)
        return
      }
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

  // If the value is changed external, sync it up with our state
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
      <ArrayModal
        variableName={variableName}
        VariableRow={index}
        arrayModalIsOpen={arrayModalIsOpen}
        setArrayModalIsOpen={setArrayModalIsOpen}
        closeContainer={() => setPoppoverIsOpen(false)}
      />
      <PrimitiveDropdown.Root onOpenChange={setPoppoverIsOpen} open={poppoverIsOpen}>
        <PrimitiveDropdown.Trigger asChild disabled={isDebuggerVisible}>
          <div
            className={cn('flex h-full w-full cursor-pointer justify-center p-2 outline-none', {
              'pointer-events-none': !selected || isDebuggerVisible,
              'cursor-default': !selected || definition === 'derived',
              'cursor-not-allowed': isDebuggerVisible,
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
            {availableVariableTypes.map((scope) => {
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
                            onSelect={() => onSelect(scope.definition as PLCVariable['type']['definition'], value)}
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

            {availableLibraryTypes.map((scope) => {
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

const SelectableClassCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = true,
}: ISelectableCellProps) => {
  const {
    editor,
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()

  const language = 'language' in editor.meta ? editor.meta.language : null

  /**
   * Every class an IEC POU can declare. Python and C++ blocks were once held
   * to `input` / `output` because their bridges carried nothing else; both now
   * marshal the rest too, so the only exclusion left is the one the codegen
   * itself refuses.
   *
   * That exclusion is read from `PYTHON_UNSUPPORTED_CLASSES` rather than
   * restated here: the picker and the bridge must not be able to disagree
   * about what a Python block accepts, and a class that stops being refused
   * should reappear in the dropdown by deleting one entry, not two.
   */
  const variableClasses = ALL_VARIABLE_CLASSES.filter(
    (variableClass) => language !== 'python' || !(variableClass in PYTHON_UNSUPPORTED_CLASSES),
  )

  // Get the current value from the table
  const currentValue = getValue()

  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(currentValue)

  // When the input is blurred, we'll call our table meta's updateData function
  const onValueChange = (value: string) => {
    // Todo: Must update the data in the store
    setCellValue(value)
    table.options.meta?.updateData(index, id, value)

    if (value === 'external') {
      table.options.meta?.updateData(index, 'initialValue', undefined)
    }

    if (value !== 'local') {
      table.options.meta?.updateData(index, 'location', '')
    }
  }

  useEffect(() => {
    setCellValue(currentValue)
  }, [currentValue])

  return (
    <Select value={cellValue as string} onValueChange={(value) => onValueChange(value)} disabled={isDebuggerVisible}>
      <SelectTrigger
        placeholder={cellValue as string}
        className={cn(
          'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
          {
            'pointer-events-none': !selected || isDebuggerVisible,
            'cursor-not-allowed': isDebuggerVisible,
          },
        )}
      />
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
      >
        {variableClasses.map((type) => (
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
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

  // When the input is blurred, we'll call our table meta's updateData function
  const onClick = () => {
    // Todo: Must update the data in the store
    setCellValue(!cellValue)
    table.options.meta?.updateData(index, id, !cellValue)
  }

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <button className='flex h-full w-full cursor-pointer items-center justify-center' onClick={onClick}>
      <DebuggerIcon variant={cellValue ? 'default' : 'muted'} />
    </button>
  )
}

/**
 * The **Flags** column: the IEC block qualifier a variable is declared under.
 *
 * Three choices, because `CONSTANT` and `RETAIN` are mutually exclusive and the
 * model stores one optional value rather than two booleans. The blank option is
 * a real choice, not a placeholder — it means a plain `VAR`, which is IEC's
 * NON_RETAIN default — so it has to be selectable to undo a flag.
 *
 * Radix rejects an empty string as a `SelectItem` value (it reserves "" for
 * "nothing selected"), so the blank option carries a sentinel that is mapped
 * back to `undefined` on the way into the store.
 */
const NO_FLAG = '__none__'

const VARIABLE_FLAGS: Array<{ value: string; label: string }> = [
  { value: NO_FLAG, label: '—' },
  { value: 'constant', label: 'Constant' },
  { value: 'retain', label: 'Retain' },
]

const SelectableFlagCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = true,
}: ISelectableCellProps) => {
  const {
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()

  const currentValue = getValue<string | undefined>() ?? NO_FLAG
  const [cellValue, setCellValue] = useState(currentValue)

  const onValueChange = (value: string) => {
    setCellValue(value)
    // Store `undefined`, never the sentinel: the persisted schema's `flag` is
    // an optional enum, so a plain VAR must carry no field at all.
    table.options.meta?.updateData(index, id, value === NO_FLAG ? undefined : value)

    // A CONSTANT cannot be located: it is folded at compile time and has no
    // storage to bind an address to. Clearing here matches how the Class cell
    // clears `location` when the class stops being `local`.
    if (value === 'constant') {
      table.options.meta?.updateData(index, 'location', '')
    }
  }

  useEffect(() => {
    setCellValue(currentValue)
  }, [currentValue])

  return (
    <Select value={cellValue} onValueChange={(value) => onValueChange(value)} disabled={isDebuggerVisible}>
      <SelectTrigger
        placeholder={VARIABLE_FLAGS.find((f) => f.value === cellValue)?.label ?? '—'}
        className={cn(
          'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
          {
            'pointer-events-none': !selected || isDebuggerVisible,
            'cursor-not-allowed': isDebuggerVisible,
          },
        )}
      />
      <SelectContent
        position='popper'
        side='bottom'
        sideOffset={-20}
        className='box h-fit w-[200px] overflow-hidden rounded-lg bg-white outline-none dark:bg-neutral-950'
      >
        {VARIABLE_FLAGS.map((flag) => (
          <SelectItem
            key={flag.value}
            value={flag.value}
            className='flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
          >
            <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
              {flag.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { SelectableClassCell, SelectableDebugCell, SelectableFlagCell, SelectableTypeCell }
