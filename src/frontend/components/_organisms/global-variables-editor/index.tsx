// import * as PrimitiveSwitch from '@radix-ui/react-switch'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { PLCGlobalVariable } from '../../../../middleware/shared/ports/types'
import { CodeIcon } from '../../../assets/icons/interface/CodeIcon'
import { MinusIcon } from '../../../assets/icons/interface/Minus'
import { PlusIcon } from '../../../assets/icons/interface/Plus'
import { StickArrowIcon } from '../../../assets/icons/interface/StickArrow'
import { TableIcon } from '../../../assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '../../../store'
import type { GlobalVariablesTableType } from '../../../store/slices/editor'
import { cn } from '../../../utils/cn'
import { parseIecStringToVariables } from '../../../utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '../../../utils/generate-iec-variables-to-string'
import TableActions from '../../_atoms/table-actions'
import { toast } from '../../_features/[app]/toast/use-toast'
import { GlobalVariablesTable } from '../../_molecules/global-variables-table'
import { VariablesCodeEditor } from '../variables-code-editor'

const GlobalVariablesEditor = () => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    project: {
      data: {
        configurations: {
          resource: { globalVariables },
        },
      },
    },
    editorActions: { updateModelVariables, updateModelVariablesForName },
    projectActions: { createVariable, deleteVariable, rearrangeVariables, setGlobalVariables },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
    workspaceActions: { removeDebugVariable },
  } = useOpenPLCStore()

  const {
    project: {
      data: { pous: snapshotPous, configurations },
    },
    snapshotActions: { pushToHistory: rawPushToHistory },
  } = useOpenPLCStore()

  const pushToHistory = useCallback(
    (pouName: string) => {
      const pou = snapshotPous.find((p) => p.name === pouName)
      if (!pou) return
      rawPushToHistory(pouName, {
        variables: pou.interface?.variables ?? [],
        body: pou.body.value,
        globalVariables: configurations.resource.globalVariables,
      })
    },
    [snapshotPous, configurations.resource.globalVariables, rawPushToHistory],
  )
  /**
   * Table data and column filters states to keep track of the table data and column filters
   */
  const [tableData, setTableData] = useState<PLCGlobalVariable[]>([])
  const [editorCode, setEditorCode] = useState(() => generateIecVariablesToString(tableData))
  const [parseError, setParseError] = useState<string | null>(null)

  const [editorVariables, setEditorVariables] = useState<GlobalVariablesTableType>({
    display: 'table',
    selectedRow: ROWS_NOT_SELECTED.toString(),
    description: '',
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const latestCodeRef = useRef(editorCode)
  const latestDisplayRef = useRef(editorVariables.display)
  const latestEditorNameRef = useRef(editor.meta.name)
  const lastParsedCodeRef = useRef(editorCode)
  const isParsingRef = useRef(false)
  const commitCodeRef = useRef<() => boolean>(() => false)

  /**
   * Update the table data and the editor's variables when the editor or the pous change
   */
  useEffect(() => {
    const variablesToTable = globalVariables.filter((variable) => variable.name)
    setTableData(variablesToTable as PLCGlobalVariable[])
  }, [editor, globalVariables])

  useEffect(() => {
    if (editorVariables.display !== 'code') {
      setEditorCode(generateIecVariablesToString(tableData))
    }
  }, [tableData, editorVariables.display])

  useEffect(() => {
    latestCodeRef.current = editorCode
    latestDisplayRef.current = editorVariables.display
    latestEditorNameRef.current = editor.meta.name
  }, [editorCode, editorVariables.display, editor.meta.name])

  useEffect(() => {
    lastParsedCodeRef.current = editorCode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.meta.name])

  useEffect(() => {
    if (editorVariables.display === 'code') {
      updateModelVariablesForName(latestEditorNameRef.current, {
        display: 'code',
        code: editorCode,
      })
    }
  }, [editorCode, editorVariables.display, updateModelVariablesForName])

  useEffect(() => {
    return () => {
      if (latestDisplayRef.current === 'code') {
        updateModelVariablesForName(latestEditorNameRef.current, {
          display: 'code',
          code: latestCodeRef.current,
        })
      }
    }
  }, [updateModelVariablesForName])

  useEffect(() => {
    if (editorVariables.display !== 'code') return

    const onDocMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return

      const isInside = containerRef.current.contains(e.target as Node)
      if (isInside) return

      if (isParsingRef.current) return

      if (editorCode === lastParsedCodeRef.current) return

      isParsingRef.current = true

      const success = commitCodeRef.current()
      if (success) {
        lastParsedCodeRef.current = editorCode
      }
      isParsingRef.current = false
    }

    document.addEventListener('mousedown', onDocMouseDown, true)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true)
    }
  }, [editorVariables.display, editorCode])

  /**
   * If the editor name is not the same as the current editor name
   * set the editor name and the editor's variables to the states
   */
  useEffect(() => {
    if (editor.type === 'plc-resource')
      if (editor.variable.display === 'table') {
        const { description, display, selectedRow } = editor.variable
        setEditorVariables({
          display: display,
          selectedRow: selectedRow,
          description: description,
        })
      } else if (editor.variable.display === 'code') {
        const code = editor.variable.code
        setEditorVariables({
          display: editor.variable.display,
        })
        if (typeof code === 'string') {
          setEditorCode(code)
        }
      }
  }, [editor])

  const handleVisualizationTypeChange = (value: 'code' | 'table') => {
    if (editorVariables.display === 'code' && value === 'table') {
      const success = commitCode()
      if (!success) return
    }

    updateModelVariables({
      display: value,
      code: value === 'code' ? editorCode : undefined,
    })
  }

  const handleRearrangeVariables = (index: number, row?: number) => {
    if (editorVariables.display === 'code') return

    pushToHistory(editor.meta.name)

    rearrangeVariables({
      scope: 'global',
      rowId: row ?? parseInt(editorVariables.selectedRow),
      newIndex: (row ?? parseInt(editorVariables.selectedRow)) + index,
    })
    updateModelVariables({
      display: 'table',
      selectedRow: parseInt(editorVariables.selectedRow) + index,
    })
    handleFileAndWorkspaceSavedState('Resource')
  }

  const handleCreateVariable = () => {
    if (editorVariables.display === 'code') return

    pushToHistory(editor.meta.name)

    const variables = globalVariables.filter((variable) => variable.name)
    const selectedRow = parseInt(editorVariables.selectedRow)

    if (variables.length === 0) {
      createVariable({
        scope: 'global',
        data: {
          name: 'GlobalVar',
          type: { definition: 'base-type', value: 'DINT' },
          class: 'global',
          location: '',
          documentation: '',
          debug: false,
        },
      })
      updateModelVariables({
        display: 'table',
        selectedRow: 0,
      })
      handleFileAndWorkspaceSavedState('Resource')

      return
    }

    const variable = (
      selectedRow === ROWS_NOT_SELECTED ? variables[variables.length - 1] : variables[selectedRow]
    ) as PLCGlobalVariable

    // Single-field location: carry a MANUAL literal address forward (it gets
    // auto-incremented for a fresh row); an alias binding starts empty so we
    // don't point two variables at the same address. See variables-editor.
    const newVarData = {
      ...variable,
      location: variable.location.startsWith('%') ? variable.location : '',
      documentation: '',
    }

    if (selectedRow === ROWS_NOT_SELECTED) {
      createVariable({ scope: 'global', data: newVarData })
      updateModelVariables({
        display: 'table',
        selectedRow: variables.length,
      })
      handleFileAndWorkspaceSavedState('Resource')
      return
    }

    createVariable({
      scope: 'global',
      data: newVarData,
      rowToInsert: selectedRow + 1,
    })
    updateModelVariables({
      display: 'table',
      selectedRow: selectedRow + 1,
    })
    handleFileAndWorkspaceSavedState('Resource')
  }

  const handleRemoveVariable = () => {
    if (editorVariables.display === 'code') return

    pushToHistory(editor.meta.name)

    const selectedRow = parseInt(editorVariables.selectedRow)
    const variableToDelete = globalVariables.filter((v) => v.name)[selectedRow]
    if (variableToDelete) {
      removeDebugVariable(`resource:${variableToDelete.name}`)
    }
    deleteVariable({ scope: 'global', rowId: selectedRow })

    const variables = globalVariables.filter((variable) => variable.name)
    if (selectedRow === variables.length - 1) {
      updateModelVariables({
        display: 'table',
        selectedRow: selectedRow - 1,
      })
    }
    handleFileAndWorkspaceSavedState('Resource')
  }

  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelVariables({
      display: 'table',
      selectedRow: parseInt(row.id),
    })
  }

  const commitCode = (): boolean => {
    try {
      pushToHistory(editor.meta.name)

      const newVariables = parseIecStringToVariables(editorCode)

      const response = setGlobalVariables({
        variables: newVariables,
      })

      if (!response.ok) {
        throw new Error(response.title + (response.message ? `: ${response.message}` : ''))
      }

      // Mark project as unsaved
      handleFileAndWorkspaceSavedState('Resource')

      setParseError(null)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected syntax error.'
      setParseError(message)
      toast({ title: 'Syntax error', description: message, variant: 'fail' })
      return false
    }
  }

  useEffect(() => {
    commitCodeRef.current = commitCode
  }, [commitCode])

  return (
    <div ref={containerRef} aria-label='Variables editor container' className='flex  w-full flex-col gap-4'>
      <div aria-label='Variables editor actions' className='relative flex h-8 w-full min-w-[1035px]'>
        <div aria-label='Variables editor table actions container' className='flex h-full w-full justify-between'>
          <span className='select-none'>Global Variables</span>

          {editorVariables.display === 'table' && (
            <div
              aria-label='Variables editor table actions container'
              className='mr-2 flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
            >
              <TableActions
                actions={[
                  {
                    ariaLabel: 'Add table row button',
                    onClick: handleCreateVariable,
                    icon: <PlusIcon className='!stroke-brand' />,
                    id: 'add-variable-button',
                  },
                  {
                    ariaLabel: 'Remove table row button',
                    onClick: handleRemoveVariable,
                    disabled: parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED,
                    icon: <MinusIcon />,
                    id: 'remove-variable-button',
                  },
                  {
                    ariaLabel: 'Move table row up button',
                    onClick: () => handleRearrangeVariables(-1),
                    disabled:
                      parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED ||
                      parseInt(editorVariables.selectedRow) === 0,
                    icon: <StickArrowIcon direction='up' className='stroke-[#0464FB]' />,
                    id: 'move-variable-up-button',
                  },
                  {
                    ariaLabel: 'Move table row down button',
                    onClick: () => handleRearrangeVariables(1),
                    disabled:
                      parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED ||
                      parseInt(editorVariables.selectedRow) === tableData.length - 1,
                    icon: <StickArrowIcon direction='down' className='stroke-[#0464FB]' />,
                    id: 'move-variable-down-button',
                  },
                ]}
              />
            </div>
          )}
        </div>

        <div
          aria-label='Variables visualization switch container'
          className={cn('flex h-fit w-fit flex-1 items-center justify-center rounded-md', {
            'absolute right-0': editorVariables.display === 'code',
          })}
        >
          <TableIcon
            aria-label='Variables table visualization'
            onClick={() => handleVisualizationTypeChange('table')}
            size='md'
            currentVisible={editorVariables.display === 'table'}
            className={cn(
              editorVariables.display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />

          <CodeIcon
            aria-label='Variables code visualization'
            onClick={() => handleVisualizationTypeChange('code')}
            size='md'
            currentVisible={editorVariables.display === 'code'}
            className={cn(
              editorVariables.display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
        </div>
      </div>
      {editorVariables.display === 'table' && (
        <div aria-label='Variables editor table container' className='' style={{ scrollbarGutter: 'stable' }}>
          <GlobalVariablesTable
            tableData={tableData}
            selectedRow={parseInt(editorVariables.selectedRow)}
            handleRowClick={handleRowClick}
          />
        </div>
      )}

      {editorVariables.display === 'code' && (
        <div
          aria-label='Variables editor code container'
          className='h-full max-h-80 overflow-y-auto'
          style={{ scrollbarGutter: 'stable' }}
        >
          <VariablesCodeEditor code={editorCode} onCodeChange={setEditorCode} shouldUseDarkMode={shouldUseDarkMode} />

          {parseError && <p className='mt-2 text-xs text-red-500'>Erro: {parseError}</p>}
        </div>
      )}
    </div>
  )
}

export { GlobalVariablesEditor }
