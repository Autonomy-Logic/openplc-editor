import { MinusIcon, PlusIcon, StickArrowIcon } from '@root/renderer/assets'
import { TableActionButton } from '@root/renderer/components/_atoms/buttons/tables-actions'
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
  } = useOpenPLCStore()
  const [tableData, setTableData] = useState<PLCStructureVariable[]>([])

  const [editorStructure, setEditorStructure] = useState<StructureTableType>({
    selectedRow: ROWS_NOT_SELECTED.toString(),
    description: '',
  })

  useEffect(() => {
    const foundDataType = dataTypes.find(
      (dataType) => dataType.derivation === 'structure' && dataType.name === editor.meta.name,
    )

    if (foundDataType && 'variable' in foundDataType) {
      setTableData(foundDataType.variable)
    } else {
      return
    }
  }, [editor, dataTypes])

  useEffect(() => {
    const foundDataType = dataTypes.find((dataType) => dataType.derivation === 'structure')
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
            initialValue: { simpleValue: { value: '' } },
          },
        ],
      })
      updateModelStructure({
        selectedRow: structureVariables.length,
      })
      return
    }

    const newVariable = {
      name: getNextVariableName(baseName),
      initialValue: { simpleValue: { value: '' } },
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
  }

  const handleDeleteStructureVariable = () => {
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
  }

  const handleRearrangeStructureVariables = (index: number, row?: number) => {
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
          <span className='select-none'>Structure</span>
          <div
            aria-label='Variables editor table actions container'
            className='flex h-full w-28 items-center justify-evenly *:rounded-md *:p-1'
          >
            {/** This can be reviewed */}
            <TableActionButton aria-label='Add table row button' onClick={() => handleCreateStructureVariable()}>
              <PlusIcon className='!stroke-brand' />
            </TableActionButton>
            <TableActionButton
              aria-label='Remove table row button'
              disabled={parseInt(editorStructure.selectedRow) === ROWS_NOT_SELECTED}
              onClick={() => handleDeleteStructureVariable()}
            >
              <MinusIcon />
            </TableActionButton>
            <TableActionButton
              onClick={() => handleRearrangeStructureVariables(-1)}
              aria-label='Move table row up button'
              disabled={
                parseInt(editorStructure.selectedRow) === ROWS_NOT_SELECTED ||
                parseInt(editorStructure.selectedRow) === 0
              }
            >
              <StickArrowIcon direction='up' className='stroke-[#0464FB]' />
            </TableActionButton>
            <TableActionButton
              onClick={() => handleRearrangeStructureVariables(1)}
              aria-label='Move table row down button'
              disabled={
                parseInt(editorStructure.selectedRow) === ROWS_NOT_SELECTED ||
                parseInt(editorStructure.selectedRow) === tableData.length - 1
              }
            >
              <StickArrowIcon direction='down' className='stroke-[#0464FB]' />
            </TableActionButton>
          </div>
        </div>
        <div aria-label='structure base type container' className='flex w-1/2 flex-col gap-3'></div>
        <div aria-label='structure initial value container' className='w-1/2'></div>
      </div>
      <div className='flex h-full w-full flex-1 flex-col overflow-hidden'>
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

