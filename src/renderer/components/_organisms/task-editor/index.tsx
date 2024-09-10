import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCTask } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useEffect, useState } from 'react'

import { TableActionButton } from '../../_atoms/buttons/tables-actions'
import TaskTable from '../../_molecules/task-table'

export default function TaskEditor() {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    workspace: {
      projectData: {
        configuration: {
          resource: { tasks },
        },
      },
    },
    editorActions: { updateModelVariables },
    workspaceActions: { createTask },
  } = useOpenPLCStore()

  const [taskData, setTaskData] = useState<PLCTask[]>([])
  const [editorVariables, setEditorVariables] = useState({
    selectedRow: ROWS_NOT_SELECTED.toString(),
    display: 'table',
  })

  useEffect(() => {
    const tasksToTable = tasks.filter((task) => task.name)
    setTaskData(tasksToTable)
  }, [editor, tasks])

  useEffect(() => {
    if (editor.type === 'plc-resource') {
      if (editor.variable.display === 'table') {
        const { selectedRow } = editor.variable
        setEditorVariables({
          selectedRow: selectedRow,
          display: 'table',
        })
      } else {
        return
      }
    }
  }, [editor])

  const handleCreateTask = () => {
    console.log('Updated taskData:', taskData)
    const tasks = taskData.filter((variable) => variable.name)
    const selectedRow = parseInt(editorVariables.selectedRow)

    if (tasks.length === 0) {
  
      createTask({
        name: 'Task',
        triggering: 'Cyclic',
        priority: 0,
        interval: '0',
      })
      updateModelVariables({
        display: 'table',
        selectedRow: 0,
      })
      return
    }

    const isValidIndex = selectedRow >= 0 && selectedRow < tasks.length
    const task: PLCTask | undefined = isValidIndex ? tasks[selectedRow] : tasks[tasks.length - 1]

    if (!task) {
      console.error('Selected task is undefined')
      return
    }

    if (selectedRow === ROWS_NOT_SELECTED) {
      console.log('Creating new task with default properties...')
      createTask({
        name: 'Task',
        triggering: task.triggering,
        priority: task.priority,
        interval: task.interval,
      })
      updateModelVariables({
        display: 'table',
        selectedRow: tasks.length,
      })
      return
    }

    console.log('Creating new task with selected properties...')
    createTask({
      name: task.name,
      triggering: task.triggering,
      priority: task.priority,
      interval: task.interval,
    })
    updateModelVariables({
      display: 'table',
      selectedRow: selectedRow + 1,
    })
  }
  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelVariables({
      display: 'table',
      selectedRow: parseInt(row.id),
    })
  }

  return (
    <div aria-label='Variables editor container' className='flex h-full w-full flex-1 flex-col gap-4 overflow-auto'>
      <div aria-label='Variables editor actions' className='relative flex h-8 w-full min-w-[1035px]'>
        {editorVariables.display === 'table' ? (
          <div aria-label='Variables editor table actions container' className='relative flex h-full w-full '>
            <div
              aria-label='Variables editor table actions container'
              className=' absolute right-0 flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
            >
              {/** This can be reviewed */}
              <TableActionButton aria-label='Add table row button' onClick={handleCreateTask}>
                <PlusIcon className='!stroke-brand' />
              </TableActionButton>
              <TableActionButton
                aria-label='Remove table row button'
                disabled={parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED}
                onClick={void 0}
              >
                <MinusIcon />
              </TableActionButton>
              <TableActionButton
                aria-label='Move table row up button'
                disabled={
                  parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED ||
                  parseInt(editorVariables.selectedRow) === 0
                }
                onClick={() => {}}
              >
                <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
              </TableActionButton>
              <TableActionButton
                aria-label='Move table row down button'
                disabled={
                  parseInt(editorVariables.selectedRow) === ROWS_NOT_SELECTED ||
                  parseInt(editorVariables.selectedRow) === taskData.length - 1
                }
                onClick={() => {}}
              >
                <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
              </TableActionButton>
            </div>
          </div>
        ) : (
          <></>
        )}
        <div
          aria-label='Variables visualization switch container'
          className={cn('flex h-fit w-fit flex-1 items-center justify-center rounded-md', {
            'absolute right-0': editorVariables.display === 'code',
          })}
        >
          <TableIcon
            aria-label='Variables table visualization'
            size='md'
            currentVisible={editorVariables.display === 'table'}
            className={cn(
              editorVariables.display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />

          <CodeIcon
            aria-label='Variables code visualization'
            onClick={() => {}}
            size='md'
            currentVisible={editorVariables.display === 'code'}
            className={cn(
              editorVariables.display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
        </div>
      </div>
      {editorVariables.display === 'table' ? (
        <div
          aria-label='Variables editor table container'
          className='h-full overflow-y-auto'
          style={{ scrollbarGutter: 'stable' }}
        >
          <TaskTable
            tableData={taskData}
            handleRowClick={handleRowClick}
            selectedRow={parseInt(editorVariables.selectedRow)}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  )
}
