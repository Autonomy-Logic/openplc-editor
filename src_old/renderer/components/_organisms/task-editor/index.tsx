import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { sharedSelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { TaskType } from '@root/renderer/store/slices'
import { PLCTask } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { parseResourceConfigurationToString } from '@root/utils/parse-resource-configuration-to-string'
import { parseResourceStringToConfiguration } from '@root/utils/parse-resource-string-to-configuration'
import { useEffect, useState } from 'react'

import TableActions from '../../_atoms/table-actions'
import { toast } from '../../_features/[app]/toast/use-toast'
import { TaskTable } from '../../_molecules/task-table'
import { VariablesCodeEditor } from '../variables-code-editor'

const TaskEditor = () => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    workspace: {
      systemConfigs: { shouldUseDarkMode },
      isDebuggerVisible,
    },
    project: {
      data: {
        configuration: {
          resource: { tasks, instances },
        },
      },
    },
    editorActions: { updateModelTasks },
    projectActions: { createTask, rearrangeTasks, deleteTask, setTasks, setInstances },
    snapshotActions: { addSnapshot },
  } = useOpenPLCStore()

  const handleFileAndWorkspaceSavedState = sharedSelectors.useHandleFileAndWorkspaceSavedState()

  const [taskData, setTaskData] = useState<PLCTask[]>([])
  const [editorCode, setEditorCode] = useState(() => parseResourceConfigurationToString(taskData, instances))
  const [parseError, setParseError] = useState<string | null>(null)

  const [editorTasks, setEditorTasks] = useState<TaskType>({
    selectedRow: ROWS_NOT_SELECTED.toString(),
    display: 'table',
  })

  useEffect(() => {
    const tasksToTable = tasks.filter((task) => task.name)
    setTaskData(tasksToTable)
  }, [editor, tasks])

  useEffect(() => {
    setEditorCode(parseResourceConfigurationToString(taskData, instances))
  }, [taskData, instances])

  useEffect(() => {
    if (editor.type === 'plc-resource') {
      if (!editor.task) {
        setEditorTasks({
          display: 'table',
          selectedRow: ROWS_NOT_SELECTED.toString(),
        })
      } else if (editor.task.display === 'table') {
        const { display, selectedRow } = editor.task
        setEditorTasks({
          display: display,
          selectedRow: selectedRow,
        })
      } else {
        setEditorTasks({
          display: editor.task.display,
        })
      }
    }
  }, [editor])

  const handleVisualizationTypeChange = (value: 'code' | 'table') => {
    if (editorTasks.display === 'code' && value === 'table') {
      const success = commitCode()
      if (!success) return
    }

    if (value === 'table') {
      updateModelTasks({
        display: 'table',
        selectedRow: editorTasks.display === 'table' ? parseInt(editorTasks.selectedRow) : ROWS_NOT_SELECTED,
      })
    } else {
      // @ts-expect-error: 'selectedRow' is not required when display is 'code'
      updateModelTasks({
        display: 'code',
      })
    }
  }

  const handleRearrangeTasks = (index: number, row?: number) => {
    if (editorTasks.display === 'code') return

    addSnapshot(editor.meta.name)

    rearrangeTasks({
      rowId: row ?? parseInt(editorTasks.selectedRow),
      newIndex: (row ?? parseInt(editorTasks.selectedRow)) + index,
    })
    updateModelTasks({
      display: 'table',
      selectedRow: parseInt(editorTasks.selectedRow) + index,
    })
    handleFileAndWorkspaceSavedState('Resource')
  }

  const getNextTaskName = (existingTasks: PLCTask[]) => {
    const baseName = 'Task'
    // Find all tasks that match the pattern "Task" followed by a number
    const taskNumbers = existingTasks
      .map((task) => {
        const match = task.name.match(/^Task(\d+)$/i)
        return match ? parseInt(match[1], 10) : -1
      })
      .filter((num) => num >= 0)

    if (taskNumbers.length === 0) {
      return 'Task0'
    }

    // Get the highest number and increment
    const maxNumber = Math.max(...taskNumbers)
    return `${baseName}${maxNumber + 1}`
  }

  const handleCreateTask = () => {
    if (editorTasks.display === 'code') return

    addSnapshot(editor.meta.name)

    const filteredTasks = taskData.filter((task) => task.name)
    const selectedRow = parseInt(editorTasks.selectedRow)

    if (filteredTasks.length === 0) {
      createTask({
        data: {
          name: 'Task0',
          triggering: 'Cyclic',
          interval: 'T#20ms',
          priority: 0,
        },
      })
      updateModelTasks({
        display: 'table',
        selectedRow: 0,
      })
      handleFileAndWorkspaceSavedState('Resource')

      return
    }

    const task: PLCTask =
      selectedRow === ROWS_NOT_SELECTED ? filteredTasks[filteredTasks.length - 1] : filteredTasks[selectedRow]

    if (!task) {
      console.error('No task found for the selectedRow:', selectedRow)
      return
    }

    if (selectedRow === ROWS_NOT_SELECTED) {
      createTask({
        data: {
          name: getNextTaskName(filteredTasks),
          triggering: 'Cyclic',
          interval: 'T#20ms',
          priority: 0,
        },
      })
      updateModelTasks({
        display: 'table',
        selectedRow: filteredTasks.length,
      })
      handleFileAndWorkspaceSavedState('Resource')

      return
    }

    createTask({ data: { ...task }, rowToInsert: selectedRow + 1 })
    updateModelTasks({
      display: 'table',
      selectedRow: selectedRow + 1,
    })
    handleFileAndWorkspaceSavedState('Resource')
  }

  const handleDeleteTask = () => {
    if (editorTasks.display === 'code') return

    addSnapshot(editor.meta.name)

    const selectedRow = parseInt(editorTasks.selectedRow)
    deleteTask({
      rowId: selectedRow,
    })

    const instances = taskData.filter((instance) => instance.name)

    if (selectedRow === instances.length - 1) {
      updateModelTasks({
        display: 'table',
        selectedRow: selectedRow - 1,
      })
    }
    handleFileAndWorkspaceSavedState('Resource')
  }
  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelTasks({
      display: 'table',
      selectedRow: parseInt(row.id),
    })
  }

  const commitCode = (): boolean => {
    try {
      addSnapshot(editor.meta.name)

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
      handleFileAndWorkspaceSavedState('Resource')

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected syntax error.'
      setParseError(message)
      toast({ title: 'Syntax error', description: message, variant: 'fail' })
      return false
    }
  }

  const isInstanceInCode = 'instance' in editor && editor.instance?.display === 'code'

  if (isInstanceInCode) return null

  return (
    <div aria-label='Tasks editor container' className='flex  w-full flex-shrink-0 flex-col gap-4 '>
      <div aria-label='Tasks editor actions' className='relative flex h-8 w-full min-w-[1035px]'>
        <div
          aria-label='Tasks editor table actions container'
          className='relative flex h-full w-full items-center justify-between'
        >
          <span className='select-none'>{editorTasks.display === 'code' ? 'Text editor' : 'Tasks'}</span>

          {editorTasks.display === 'table' && (
            <div
              aria-label='Tasks editor table actions container'
              className='  mr-2 flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
            >
              <TableActions
                actions={[
                  {
                    ariaLabel: 'Add Tasks table row button',
                    onClick: handleCreateTask,
                    disabled: isDebuggerVisible,
                    icon: <PlusIcon className='!stroke-brand' />,
                    id: 'add-task-button',
                  },
                  {
                    ariaLabel: 'Remove Tasks table row button',
                    onClick: handleDeleteTask,
                    disabled: isDebuggerVisible || parseInt(editorTasks.selectedRow) === ROWS_NOT_SELECTED,
                    icon: <MinusIcon />,
                    id: 'remove-task-button',
                  },
                  {
                    ariaLabel: 'Move Tasks table row up button',
                    onClick: () => handleRearrangeTasks(-1),
                    disabled:
                      isDebuggerVisible ||
                      parseInt(editorTasks.selectedRow) === ROWS_NOT_SELECTED ||
                      parseInt(editorTasks.selectedRow) === 0,
                    icon: <StickArrowIcon direction='up' className='stroke-[#0464FB]' />,
                    id: 'move-task-up-button',
                  },
                  {
                    ariaLabel: 'Move Tasks table row down button',
                    onClick: () => handleRearrangeTasks(1),
                    disabled:
                      isDebuggerVisible ||
                      parseInt(editorTasks.selectedRow) === ROWS_NOT_SELECTED ||
                      parseInt(editorTasks.selectedRow) === taskData.length - 1,
                    icon: <StickArrowIcon direction='down' className='stroke-[#0464FB]' />,
                    id: 'move-task-down-button',
                  },
                ]}
              />
            </div>
          )}
        </div>

        <div
          aria-label='Tasks visualization switch container'
          className={cn('flex h-fit w-fit flex-1 items-center justify-center rounded-md', {
            'absolute right-0': editorTasks.display === 'code',
          })}
        >
          <TableIcon
            aria-label='Tasks table visualization'
            size='md'
            onClick={() => handleVisualizationTypeChange('table')}
            currentVisible={editorTasks.display === 'table'}
            className={cn(
              editorTasks.display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />

          <CodeIcon
            aria-label='Tasks code visualization'
            onClick={() => handleVisualizationTypeChange('code')}
            size='md'
            currentVisible={editorTasks.display === 'code'}
            className={cn(
              editorTasks.display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
        </div>
      </div>

      {editorTasks.display === 'table' && (
        <div aria-label='Tasks editor table container' className='' style={{ scrollbarGutter: 'stable' }}>
          <TaskTable
            tableData={taskData}
            handleRowClick={handleRowClick}
            selectedRow={parseInt(editorTasks.selectedRow)}
          />
        </div>
      )}

      {editorTasks.display === 'code' && (
        <div
          aria-label='Task editor code container'
          className='min-h-96 flex-1 overflow-y-auto'
          style={{ scrollbarGutter: 'stable' }}
        >
          <VariablesCodeEditor code={editorCode} onCodeChange={setEditorCode} shouldUseDarkMode={shouldUseDarkMode} />

          {parseError && <p className='mt-2 text-xs text-red-500'>Error: {parseError}</p>}
        </div>
      )}
    </div>
  )
}

export { TaskEditor }
