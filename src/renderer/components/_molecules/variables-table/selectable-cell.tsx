import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { ArrowIcon, DebuggerIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { FBDFlowActions, FBDFlowState, LadderFlowActions, LadderFlowState } from '@root/renderer/store/slices'
import type { PLCVariable } from '@root/types/PLC/open-plc'
import { baseTypeSchema } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext } from '@tanstack/react-table'
import { Node } from '@xyflow/react'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { InputWithRef, Select, SelectContent, SelectItem, SelectTrigger } from '../../_atoms'
import { ArrayModal } from './elements/array-modal'

type ISelectableCellProps = CellContext<PLCVariable, unknown> & { selected?: boolean }

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
    ladderFlowActions: { updateNode },
    fbdFlowActions: { updateNode: updateFBDNode },
    libraries: sliceLibraries,
  } = useOpenPLCStore()

  const VariableTypes = [
    {
      definition: 'base-type',
      values: baseTypeSchema.options,
    },
    {
      definition: 'user-data-type',
      values: dataTypes.map((dataType) => dataType.name),
    },
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
      values: sliceLibraries.user
        .filter((userLibrary) => userLibrary.name !== editor.meta.name)
        .flatMap((userLibrary) =>
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

  // const pou = pous.find((pou) => pou.data.name === editor.meta.name)

  const { value, definition } = getValue<PLCVariable['type']>()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState<PLCVariable['type']['value']>(value)
  const [arrayModalIsOpen, setArrayModalIsOpen] = useState(false)
  const [poppoverIsOpen, setPoppoverIsOpen] = useState(false)
  const variableName = table.options.data[index].name

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

  const getBlockExpectedType = (node: Node): string => {
    const variant = (node.data as { variant?: { name?: string } }).variant

    if (variant && typeof variant.name === 'string') {
      return variant.name.trim().toUpperCase()
    }

    return ''
  }

  const sameType = (firstType: string, secondType: string) =>
    firstType.toString().trim().toLowerCase() === secondType.toString().trim().toLowerCase()

  const syncNodesWithVariables = (
    newVars: PLCVariable[],
    ladderFlows: LadderFlowState['ladderFlows'],
    updateNode: LadderFlowActions['updateNode'],
  ) => {
    ladderFlows.forEach((flow) =>
      flow.rungs.forEach((rung) =>
        rung.nodes.forEach((node) => {
          const nodeVar = (node.data as { variable?: PLCVariable }).variable

          if (!nodeVar) return

          const target = newVars.find((v) => v.name.toLowerCase() === nodeVar.name.toLowerCase())

          if (!target) return

          const expectedType = getBlockExpectedType(node)

          const isTheSameType = sameType(target.type.value, expectedType)

          if (!isTheSameType) {
            updateNode({
              editorName: flow.name,
              rungId: rung.id,
              nodeId: node.id,
              node: {
                ...node,
                data: {
                  ...node.data,
                  variable: { ...target, id: `broken-${node.id}` },
                  wrongVariable: true,
                },
              },
            })

            return
          }

          if ((node.data as { wrongVariable?: PLCVariable }).wrongVariable) {
            updateNode({
              editorName: flow.name,
              rungId: rung.id,
              nodeId: node.id,
              node: {
                ...node,
                data: {
                  ...node.data,
                  variable: target,
                  wrongVariable: false,
                },
              },
            })
          }
        }),
      ),
    )
  }

  const syncNodesWithVariablesFBD = (
    newVars: PLCVariable[],
    fbdFlows: FBDFlowState['fbdFlows'],
    updateNode: FBDFlowActions['updateNode'],
  ) => {
    fbdFlows.forEach((flow) =>
      flow.rung.nodes.forEach((node) => {
        const nodeVar = (node.data as { variable?: PLCVariable }).variable

        if (!nodeVar) return

        const target = newVars.find((v) => v.name.toLowerCase() === nodeVar.name.toLowerCase())

        if (!target) return

        const expectedType = getBlockExpectedType(node)

        const isTheSameType = sameType(target.type.value, expectedType)

        if (!isTheSameType) {
          updateNode({
            editorName: flow.name,
            nodeId: node.id,
            node: {
              ...node,
              data: {
                ...node.data,
                variable: { ...target, id: `broken-${node.id}` },
                wrongVariable: true,
              },
            },
          })

          return
        }

        if ((node.data as { wrongVariable?: PLCVariable }).wrongVariable) {
          updateNode({
            editorName: flow.name,
            nodeId: node.id,
            node: {
              ...node,
              data: {
                ...node.data,
                variable: target,
                wrongVariable: false,
              },
            },
          })
        }
      }),
    )
  }

  // When the input is blurred, we'll call our table meta's updateData function
  const onSelect = (definition: PLCVariable['type']['definition'], value: PLCVariable['type']['value']) => {
    const language = 'language' in editor.meta ? editor.meta.language : undefined

    table.options.meta?.updateData(index, id, { definition, value })

    const {
      project: {
        data: { pous: freshPous },
      },
      ladderFlows: freshLadderFlows,
      fbdFlows: freshFBDFlows,
    } = useOpenPLCStore.getState()

    const pou = freshPous.find((p) => p.data.name === editor.meta.name)

    const newVars = pou?.data.variables ?? []

    if (language === 'fbd') {
      syncNodesWithVariablesFBD(newVars, freshFBDFlows, updateFBDNode)
    }

    if (language === 'ld') {
      syncNodesWithVariables(newVars, freshLadderFlows, updateNode)
    }

    setCellValue(value)
  }

  // If the value is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(value)
  }, [value])

  return (
    <PrimitiveDropdown.Root onOpenChange={setPoppoverIsOpen} open={poppoverIsOpen}>
      <PrimitiveDropdown.Trigger
        asChild
        // disabled={pou?.data.language !== 'st' && pou?.data.language !== 'il' && definition === 'derived'}
      >
        <div
          className={cn('flex h-full w-full cursor-pointer justify-center p-2 outline-none', {
            'pointer-events-none': !selected,
            'cursor-default': !selected || definition === 'derived',
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

          <PrimitiveDropdown.Item asChild>
            <ArrayModal
              variableName={variableName}
              VariableRow={index}
              arrayModalIsOpen={arrayModalIsOpen}
              setArrayModalIsOpen={setArrayModalIsOpen}
              closeContainer={() => setPoppoverIsOpen(false)}
            />
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
  )
}

const SelectableClassCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = true,
}: ISelectableCellProps) => {
  const { editor } = useOpenPLCStore()

  const getVariableClasses = () => {
    const language = 'language' in editor.meta ? editor.meta.language : null
    if (language === 'python') {
      return ['input', 'output']
    }
    return ['input', 'output', 'inOut', 'external', 'local', 'temp']
  }

  const variableClasses = getVariableClasses()

  const initialValue = getValue()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

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

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <Select value={cellValue as string} onValueChange={(value) => onValueChange(value)}>
      <SelectTrigger
        placeholder={cellValue as string}
        className={cn(
          'flex h-full w-full justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
          { 'pointer-events-none': !selected },
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
  const initialValue = getValue<boolean>()
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

export { SelectableClassCell, SelectableDebugCell, SelectableTypeCell }
