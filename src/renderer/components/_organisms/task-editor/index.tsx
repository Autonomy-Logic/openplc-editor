import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '@root/renderer/store'
import { TaskType } from '@root/renderer/store/slices'
import { PLCTask } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useEffect, useState } from 'react'

import { TableActionButton } from '../../_atoms/buttons/tables-actions'
import { TaskTable } from '../../_molecules/task-table'

const TaskEditor = () => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    project: {
      data: {
        configuration: {
          resource: { tasks },
        },
      }
    },
    editorActions: { updateModelTasks },
    projectActions: { createTask, rearrangeTasks, deleteTask },
  } = useOpenPLCStore()

  const [taskData, setTaskData] = useState<PLCTask[]>([])
  const [editorTasks, setEditorTasks] = useState<TaskType>({
    selectedRow: ROWS_NOT_SELECTED.toString(),
    display: 'table',
  })

  useEffect(() => {
    const tasksToTable = tasks.filter((task) => task.name)
    setTaskData(tasksToTable)
  }, [editor, tasks])

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

  const handleRearrangeTasks = (index: number, row?: number) => {
    if (editorTasks.display === 'code') return
    rearrangeTasks({
      rowId: row ?? parseInt(editorTasks.selectedRow),
      newIndex: (row ?? parseInt(editorTasks.selectedRow)) + index,
    })
    updateModelTasks({
      display: 'table',
      selectedRow: parseInt(editorTasks.selectedRow) + index,
    })
  }

  const handleCreateTask = () => {
    if (editorTasks.display === 'code') return
    const tasks = taskData.filter((task) => task.name)
    const selectedRow = parseInt(editorTasks.selectedRow)

    if (tasks.length === 0) {
      createTask({
        data: {
          name: 'Task',
          triggering: 'Cyclic',
          interval: 'T#0d0h0min0s20ms0µs',
          priority: 0,
        },
      })
      updateModelTasks({
        display: 'table',
        selectedRow: 0,
      })
      return
    }

    const task: PLCTask = selectedRow === ROWS_NOT_SELECTED ? tasks[tasks.length - 1] : tasks[selectedRow]

    if (!task) {
      console.error('No task found for the selectedRow:', selectedRow)
      return
    }

    if (selectedRow === ROWS_NOT_SELECTED) {
      createTask({
        data: {
          name: 'Task',
          triggering: 'Cyclic',
          interval: 'T#0d0h0min0s20ms0µs',
          priority: 0,
        },
      })
      updateModelTasks({
        display: 'table',
        selectedRow: tasks.length,
      })
      return
    }

    createTask({ data: { ...task }, rowToInsert: selectedRow + 1 })
    updateModelTasks({
      display: 'table',
      selectedRow: selectedRow + 1,
    })

  }
  const handleDeleteTask = () => {
    if (editorTasks.display === 'code') return

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
  }
  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelTasks({
      display: 'table',
      selectedRow: parseInt(row.id),
    })
  }
  return (
    <div aria-label='Tasks editor container' className='flex  w-full flex-shrink-0 flex-col gap-4 '>
      <div aria-label='Tasks editor actions' className='relative flex h-8 w-full min-w-[1035px]'>
        {editorTasks.display === 'table' ? (
          <div
            aria-label='Tasks editor table actions container'
            className='relative flex h-full w-full items-center justify-between'
          >
            <span className='select-none'>Tasks</span>
            <div
              aria-label='Tasks editor table actions container'
              className='  flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
            >
              {/** This can be reviewed */}
              <TableActionButton aria-label='Add Tasks table row button' onClick={handleCreateTask}>
                <PlusIcon className='!stroke-brand' />
              </TableActionButton>
              <TableActionButton
                aria-label='Remove Tasks table row button'
                disabled={parseInt(editorTasks.selectedRow) === ROWS_NOT_SELECTED}
                onClick={() => {
                  handleDeleteTask()
                }}
              >
                <MinusIcon />
              </TableActionButton>
              <TableActionButton
                aria-label='Move Tasks table row up button'
                disabled={
                  parseInt(editorTasks.selectedRow) === ROWS_NOT_SELECTED || parseInt(editorTasks.selectedRow) === 0
                }
                onClick={() => handleRearrangeTasks(-1)}
              >
                <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
              </TableActionButton>
              <TableActionButton
                aria-label='Move Tasks table row down button'
                disabled={
                  parseInt(editorTasks.selectedRow) === ROWS_NOT_SELECTED ||
                  parseInt(editorTasks.selectedRow) === taskData.length - 1
                }
                onClick={() => handleRearrangeTasks(1)}
              >
                <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
              </TableActionButton>
            </div>
          </div>
        ) : (
          <></>
        )}
        <div
          aria-label='Tasks visualization switch container'
          className={cn('flex h-fit w-fit flex-1 items-center justify-center rounded-md', {
            'absolute right-0': editorTasks.display === 'code',
          })}
        >
          <TableIcon
            aria-label='Tasks table visualization'
            size='md'
            currentVisible={editorTasks.display === 'table'}
            className={cn(
              editorTasks.display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />

          <CodeIcon
            aria-label='Tasks code visualization'
            onClick={() => {}}
            size='md'
            currentVisible={editorTasks.display === 'code'}
            className={cn(
              editorTasks.display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
        </div>
      </div>
      {editorTasks.display === 'table' ? (
        <div aria-label='Tasks editor table container' className='' style={{ scrollbarGutter: 'stable' }}>
          <TaskTable
            tableData={taskData}
            handleRowClick={handleRowClick}
            selectedRow={parseInt(editorTasks.selectedRow)}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  )
}

export { TaskEditor }
