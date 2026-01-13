import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import TableActions from '@root/renderer/components/_atoms/table-actions'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { StructureTableType } from '@root/renderer/store/slices'
import { PLCStructureVariable } from '@root/types/PLC/open-plc'
import { useEffect, useState } from 'react'

import { StructureTable } from './table'

const StructureDataType = () => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    project: {
      data: { dataTypes },
    },
    editorActions: { updateModelStructure },
    projectActions: { updateDatatype, rearrangeStructureVariables },
    snapshotActions: { addSnapshot },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const [tableData, setTableData] = useState<PLCStructureVariable[]>([])

  const [editorStructure, setEditorStructure] = useState<StructureTableType>({
    selectedRow: ROWS_NOT_SELECTED.toString(),
    description: '',
  })

  useEffect(() => {
    const foundDataType = dataTypes.find(
      (dataType) => dataType?.derivation === 'structure' && dataType.name === editor.meta.name,
    )

    if (foundDataType && 'variable' in foundDataType) {
      setTableData(foundDataType.variable)
    } else {
      return
    }
  }, [editor, dataTypes])

  useEffect(() => {
    const foundDataType = dataTypes.find((dataType) => dataType?.derivation === 'structure')
    if (editor.type === 'plc-datatype' && foundDataType && 'variable' in foundDataType) {
      const { description, selectedRow } = editor.structure
      setEditorStructure({ description: description, selectedRow: selectedRow })
    }
  }, [editor])

  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelStructure({
      selectedRow: parseInt(row.id),
    })
  }

  const handleCreateStructureVariable = () => {
    addSnapshot(editor.meta.name)

    const structureVariables = tableData.filter((variable) => variable.name || variable.type)
    const selectedRow = parseInt(editorStructure.selectedRow)

    const getNextVariableName = (baseName: string) => {
      let newName = baseName
      let counter = 1

      while (structureVariables.some((variable) => variable.name === newName)) {
        newName = `${baseName}_${counter}`
        counter++
      }

      return newName
    }

    const selectedVariableName =
      selectedRow === ROWS_NOT_SELECTED
        ? structureVariables[structureVariables.length - 1]?.name || 'structureVar'
        : structureVariables[selectedRow]?.name || 'structureVar'

    const baseName = selectedVariableName.replace(/_\d+$/, '')

    if (structureVariables.some((variable) => variable.name === '')) {
      toast({
        title: 'Invalid name',
        description: 'Name cannot be empty',
        variant: 'fail',
      })
      return
    }

    const structureVariable: PLCStructureVariable =
      selectedRow === ROWS_NOT_SELECTED
        ? structureVariables[structureVariables.length - 1]
        : structureVariables[selectedRow]

    if (!structureVariable || !structureVariable.type) {
      updateDatatype(editor.meta.name, {
        derivation: 'structure',
        name: editor.meta.name,
        variable: [
          ...structureVariables,
          {
            name: getNextVariableName(baseName),
            type: { definition: 'base-type', value: 'dint' },
          },
        ],
      })
      updateModelStructure({
        selectedRow: structureVariables.length,
      })
      handleFileAndWorkspaceSavedState(editor.meta.name)

      return
    }

    const newVariable = {
      name: getNextVariableName(baseName),
      type: structureVariable.type,
    }

    if (selectedRow === ROWS_NOT_SELECTED) {
      updateDatatype(editor.meta.name, {
        derivation: 'structure',
        name: editor.meta.name,
        variable: [...structureVariables, newVariable],
      })
      updateModelStructure({
        selectedRow: structureVariables.length,
      })
    } else {
      updateDatatype(editor.meta.name, {
        derivation: 'structure',
        name: editor.meta.name,
        variable: [
          ...structureVariables.slice(0, selectedRow + 1),
          newVariable,
          ...structureVariables.slice(selectedRow + 1),
        ],
      })
      updateModelStructure({
        selectedRow: selectedRow + 1,
      })
    }
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const handleDeleteStructureVariable = () => {
    addSnapshot(editor.meta.name)

    const structureVariables = tableData.filter((variable) => variable.name || variable.type)
    const selectedRow = parseInt(editorStructure.selectedRow)

    if (selectedRow === ROWS_NOT_SELECTED || selectedRow >= structureVariables.length) {
      return
    }

    const updatedVariables = [...structureVariables.slice(0, selectedRow), ...structureVariables.slice(selectedRow + 1)]

    updateDatatype(editor.meta.name, {
      derivation: 'structure',
      name: editor.meta.name,
      variable: updatedVariables,
    })

    let newSelectedRow = selectedRow - 1
    if (newSelectedRow < 0 && updatedVariables.length > 0) {
      newSelectedRow = 0
    } else if (updatedVariables.length === 0) {
      newSelectedRow = ROWS_NOT_SELECTED
    }

    updateModelStructure({
      selectedRow: newSelectedRow,
    })
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }

  const handleRearrangeStructureVariables = (index: number, row?: number) => {
    addSnapshot(editor.meta.name)

    rearrangeStructureVariables({
      associatedDataType: editor.meta.name,
      rowId: row ?? parseInt(editorStructure.selectedRow),
      newIndex: (row ?? parseInt(editorStructure.selectedRow)) + index,
    })
    updateModelStructure({
      selectedRow: parseInt(editorStructure.selectedRow) + index,
    })
  }

  return (
    <div
      aria-label=' structure data type container'
      className='flex h-full w-full flex-1 flex-col gap-4 overflow-hidden bg-transparent'
    >
      <div aria-label='Data type content actions container' className='flex h-8 w-full'>
        <div aria-label='Variables editor table actions container' className='flex h-full w-full justify-between'>
          <div
            aria-label='Variables editor table actions container'
            className='flex h-full w-28 flex-grow items-center justify-end *:rounded-md *:p-1'
          >
            <TableActions
              actions={[
                {
                  ariaLabel: 'Add table row button',
                  onClick: handleCreateStructureVariable,
                  icon: <PlusIcon className='!stroke-brand' />,
                  id: 'add-new-row-button',
                },
                {
                  ariaLabel: 'Remove table row button',
                  onClick: handleDeleteStructureVariable,
                  disabled: parseInt(editorStructure.selectedRow) === ROWS_NOT_SELECTED,
                  icon: <MinusIcon className='stroke-[#0464FB]' />,
                },
                {
                  ariaLabel: 'Move table row up button',
                  onClick: () => handleRearrangeStructureVariables(-1),
                  disabled:
                    parseInt(editorStructure.selectedRow) === ROWS_NOT_SELECTED ||
                    parseInt(editorStructure.selectedRow) === 0,
                  icon: <StickArrowIcon direction='up' className='stroke-[#0464FB]' />,
                },
                {
                  ariaLabel: 'Move table row down button',
                  onClick: () => handleRearrangeStructureVariables(1),
                  disabled:
                    parseInt(editorStructure.selectedRow) === ROWS_NOT_SELECTED ||
                    parseInt(editorStructure.selectedRow) === tableData.length - 1,
                  icon: <StickArrowIcon direction='down' className='stroke-[#0464FB]' />,
                },
              ]}
            />
          </div>
        </div>
      </div>

      <div className='h-full w-full overflow-auto pr-1' style={{ scrollbarGutter: 'stable' }}>
        <StructureTable
          tableData={tableData}
          selectedRow={parseInt(editorStructure.selectedRow)}
          handleRowClick={handleRowClick}
        />
      </div>
    </div>
  )
}

export { StructureDataType }
