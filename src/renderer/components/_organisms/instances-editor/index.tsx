import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { useOpenPLCStore } from '@root/renderer/store'
import { InstanceType } from '@root/renderer/store/slices'
import { PLCInstance } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import { useEffect, useState } from 'react'

import TableActions from '../../_atoms/table-actions'
import { InstancesTable } from '../../_molecules/instances-table'

const InstancesEditor = () => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    project: {
      data: {
        configuration: {
          resource: { instances },
        },
      },
    },
    editorActions: { updateModelInstances },
    projectActions: { createInstance, rearrangeInstances, deleteInstance },
  } = useOpenPLCStore()

  const [instanceData, setInstanceData] = useState<PLCInstance[]>([])

  const [editorInstances, setEditorInstances] = useState<InstanceType>({
    selectedRow: ROWS_NOT_SELECTED.toString(),
    display: 'table',
  })

  useEffect(() => {
    const instancesToTable = instances.filter((instance) => instance.name)
    setInstanceData(instancesToTable)
  }, [editor, instances])

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
          display: editor.instance.display,
        })
      }
    }
  }, [editor])

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
          name: 'instance',
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

  return (
    <div aria-label='instances editor container' className='flex w-full  flex-col gap-4 '>
      <div aria-label='instances editor actions' className='relative flex h-8 w-full min-w-[1035px]'>
        {editorInstances.display === 'table' ? (
          <div
            aria-label='instances editor table actions container'
            className='relative flex h-full w-full items-center justify-between'
          >
            <span className='select-none'>Instances</span>
            <div
              aria-label='instances editor table actions container'
              className='  flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
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
          </div>
        ) : (
          <></>
        )}
        <div
          aria-label='instances visualization switch container'
          className={cn('flex h-fit w-fit flex-1 items-center justify-center rounded-md', {
            'absolute right-0': editorInstances.display === 'code',
          })}
        >
          <TableIcon
            aria-label='instances table visualization'
            size='md'
            currentVisible={editorInstances.display === 'table'}
            className={cn(
              editorInstances.display === 'table' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-l-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />

          <CodeIcon
            aria-label='instances code visualization'
            onClick={() => {}}
            size='md'
            currentVisible={editorInstances.display === 'code'}
            className={cn(
              editorInstances.display === 'code' ? 'fill-brand' : 'fill-neutral-100 dark:fill-neutral-900',
              'rounded-r-md transition-colors ease-in-out hover:cursor-pointer',
            )}
          />
        </div>
      </div>
      {editorInstances.display === 'table' ? (
        <div aria-label='instances editor table container' className='' style={{ scrollbarGutter: 'stable' }}>
          <InstancesTable
            tableData={instanceData}
            handleRowClick={handleRowClick}
            selectedRow={parseInt(editorInstances.selectedRow)}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  )
}

export { InstancesEditor }
