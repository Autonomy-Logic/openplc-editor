import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '@root/renderer/store'
import { InstanceType } from '@root/renderer/store/slices'
import { PLCInstance } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { parseResourceConfigurationToString } from '@root/utils/parse-resource-configuration-to-string'
import { parseResourceStringToConfiguration } from '@root/utils/parse-resource-string-to-configuration'
import { useEffect, useState } from 'react'

import TableActions from '../../_atoms/table-actions'
import { toast } from '../../_features/[app]/toast/use-toast'
import { InstancesTable } from '../../_molecules/instances-table'
import { VariablesCodeEditor } from '../variables-code-editor'

const InstancesEditor = () => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    workspace: {
      systemConfigs: { shouldUseDarkMode },
    },
    project: {
      data: {
        configuration: {
          resource: { instances, tasks },
        },
      },
    },
    editorActions: { updateModelInstances },
    projectActions: { createInstance, rearrangeInstances, deleteInstance, setInstances, setTasks },
  } = useOpenPLCStore()

  const [instanceData, setInstanceData] = useState<PLCInstance[]>([])
  const [editorCode, setEditorCode] = useState(() => parseResourceConfigurationToString(tasks, instanceData))
  const [parseError, setParseError] = useState<string | null>(null)

  const [editorInstances, setEditorInstances] = useState<InstanceType>({
    selectedRow: ROWS_NOT_SELECTED.toString(),
    display: 'table',
  })

  useEffect(() => {
    const instancesToTable = instances.filter((instance) => instance.name)
    setInstanceData(instancesToTable)
  }, [editor, instances])

  useEffect(() => {
    setEditorCode(parseResourceConfigurationToString(tasks, instanceData))
  }, [instanceData, tasks])

  const otherIsCode = 'task' in editor && editor.task?.display === 'code'
  const showTable = editorInstances.display === 'table' && !otherIsCode
  const showCode = editorInstances.display === 'code'

  useEffect(() => {
    if (editor.type === 'plc-resource') {
      if (!editor.instance) {
        setEditorInstances({
          display: 'table',
          selectedRow: ROWS_NOT_SELECTED.toString(),
        })
      } else if (editor.instance.display === 'table') {
        const { display, selectedRow } = editor.instance
        setEditorInstances({
          display: display,
          selectedRow: selectedRow,
        })
      } else {
        setEditorInstances({
          display: 'code',
        })
      }
    }
  }, [ROWS_NOT_SELECTED, editor])

  const handleVisualizationTypeChange = (value: 'code' | 'table') => {
    if (editorInstances.display === 'code' && value === 'table') {
      const success = commitCode()
      if (!success) return
    }

    if (value === 'table') {
      updateModelInstances({
        display: 'table',
        selectedRow: editorInstances.display === 'table' ? parseInt(editorInstances.selectedRow) : ROWS_NOT_SELECTED,
      })
    } else {
      updateModelInstances({
        display: 'code',
      })
    }
  }

  const handleRearrangeInstances = (index: number, row?: number) => {
    if (editorInstances.display === 'code') return
    rearrangeInstances({
      rowId: row ?? parseInt(editorInstances.selectedRow),
      newIndex: (row ?? parseInt(editorInstances.selectedRow)) + index,
    })
    updateModelInstances({
      display: 'table',
      selectedRow: parseInt(editorInstances.selectedRow) + index,
    })
  }

  const handleCreateInstance = () => {
    if (editorInstances.display === 'code') return
    const instances = instanceData.filter((instance) => instance.name)
    const selectedRow = parseInt(editorInstances.selectedRow)

    if (instances.length === 0) {
      createInstance({
        data: {
          name: 'instance0',
          program: '',
          task: '',
        },
      })
      updateModelInstances({
        display: 'table',
        selectedRow: 0,
      })
      return
    }

    const instance: PLCInstance =
      selectedRow === ROWS_NOT_SELECTED ? instances[instances.length - 1] : instances[selectedRow]

    if (!instance) {
      console.error('No instance found for the selectedRow:', selectedRow)
      return
    }

    if (selectedRow === ROWS_NOT_SELECTED) {
      createInstance({ data: { ...instance } })
      updateModelInstances({
        display: 'table',
        selectedRow: instances.length,
      })
      return
    }

    createInstance({ data: { ...instance }, rowToInsert: selectedRow + 1 })
    updateModelInstances({
      display: 'table',
      selectedRow: selectedRow + 1,
    })
  }

  const handleDeleteInstance = () => {
    if (editorInstances.display === 'code') return

    const selectedRow = parseInt(editorInstances.selectedRow)
    deleteInstance({
      rowId: selectedRow,
    })

    const instances = instanceData.filter((instance) => instance.name)

    if (selectedRow === instances.length - 1) {
      updateModelInstances({
        display: 'table',
        selectedRow: selectedRow - 1,
      })
    }
  }

  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelInstances({
      display: 'table',
      selectedRow: parseInt(row.id),
    })
  }

  const commitCode = (): boolean => {
    try {
      const { instances, tasks } = parseResourceStringToConfiguration(editorCode)

      const response = setInstances({
        instances,
      })

      const tasksResponse = setTasks({
        tasks,
      })

      if (!tasksResponse.ok) {
        throw new Error(tasksResponse.title + (tasksResponse.message ? `: ${tasksResponse.message}` : ''))
      }

      if (!response.ok) {
        throw new Error(response.title + (response.message ? `: ${response.message}` : ''))
      }

      toast({ title: 'Update tables', description: 'Changes applied successfully.' })
      setParseError(null)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected syntax error.'
      setParseError(message)
      toast({ title: 'Syntax error', description: message, variant: 'fail' })
      return false
    }
  }

  const isTaskInCode = 'task' in editor && editor.task?.display === 'code'

  if (isTaskInCode) return null

  return (
    <div aria-label='instances editor container' className='flex w-full  flex-col gap-4 '>
      <div aria-label='instances editor actions' className='relative flex h-8 w-full min-w-[1035px]'>
        <div
          aria-label='instances editor table actions container'
          className='relative flex h-full w-full items-center justify-between'
        >
          {editorInstances.display === 'code' ? 'Text editor' : 'Instances'}

          {editorInstances.display === 'table' && (
            <div
              aria-label='instances editor table actions container'
              className='  mr-2 flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
            >
              <TableActions
                actions={[
                  {
                    ariaLabel: 'Add instances table row button',
                    onClick: handleCreateInstance,
                    icon: <PlusIcon className='!stroke-brand' />,
                    id: 'add-instance-button',
                  },
                  {
                    ariaLabel: 'Remove instances table row button',
                    onClick: handleDeleteInstance,
                    disabled: parseInt(editorInstances.selectedRow) === ROWS_NOT_SELECTED,
                    icon: <MinusIcon />,
                    id: 'remove-instance-button',
                  },
                  {
                    ariaLabel: 'Move instances table row up button',
                    onClick: () => handleRearrangeInstances(-1),
                    disabled:
                      parseInt(editorInstances.selectedRow) === ROWS_NOT_SELECTED ||
                      parseInt(editorInstances.selectedRow) === 0,
                    icon: <StickArrowIcon direction='up' className='stroke-[#0464FB]' />,
                    id: 'move-instance-up-button',
                  },
                  {
                    ariaLabel: 'Move instances table row down button',
                    onClick: () => handleRearrangeInstances(1),
                    disabled:
                      parseInt(editorInstances.selectedRow) === ROWS_NOT_SELECTED ||
                      parseInt(editorInstances.selectedRow) === instanceData.length - 1,
                    icon: <StickArrowIcon direction='down' className='stroke-[#0464FB]' />,
                    id: 'move-instance-down-button',
                  },
                ]}
              />
            </div>
          )}
        </div>

        <div
          aria-label='instances visualization switch container'
          className={cn('flex h-fit w-fit flex-1 items-center justify-center rounded-md', {
            'absolute right-0': editorInstances.display === 'code',
          })}
        >
          <TableIcon
            aria-label='instances table visualization'
            size='md'
            onClick={() => handleVisualizationTypeChange('table')}
            currentVisible={editorInstances.display === 'table'}
            className={cn(
              editorInstances.display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />

          <CodeIcon
            aria-label='instances code visualization'
            onClick={() => handleVisualizationTypeChange('code')}
            size='md'
            currentVisible={editorInstances.display === 'code'}
            className={cn(
              editorInstances.display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
        </div>
      </div>
      {showTable && (
        <div aria-label='instances editor table container' style={{ scrollbarGutter: 'stable' }}>
          <InstancesTable
            tableData={instanceData}
            handleRowClick={handleRowClick}
            selectedRow={parseInt(editorInstances.selectedRow)}
          />
        </div>
      )}

      {showCode && (
        <div
          aria-label='Instance editor code container'
          className='min-h-96 flex-1 overflow-y-auto'
          style={{ scrollbarGutter: 'stable' }}
        >
          <VariablesCodeEditor code={editorCode} onCodeChange={setEditorCode} shouldUseDarkMode={shouldUseDarkMode} />
          {parseError && <p className='mt-2 text-xs text-red-500'>Erro: {parseError}</p>}
        </div>
      )}
    </div>
  )
}

export { InstancesEditor }
