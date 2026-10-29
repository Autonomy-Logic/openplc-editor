import { useEffect, useState } from 'react'

import type { PLCStructureVariable } from '../../../../../middleware/shared/ports/types'
import { MinusIcon } from '../../../../assets/icons/interface/Minus'
import { PlusIcon } from '../../../../assets/icons/interface/Plus'
import { StickArrowIcon } from '../../../../assets/icons/interface/StickArrow'
import { usePouSnapshot } from '../../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../../store'
import type { StructureTableType } from '../../../../store/slices/editor/types'
import TableActions from '../../../_atoms/table-actions'
import { toast } from '../../../_features/[app]/toast/use-toast'
import { StructureTable } from './table'

type StructureDataTypeProps = {
  dataTypeName: string
}

const StructureDataType = ({ dataTypeName }: StructureDataTypeProps) => {
  const ROWS_NOT_SELECTED = -1
  const {
    editor,
    editors,

    project: {
      data: { dataTypes },
    },
    editorActions: { updateModelStructureForName },
    projectActions: { updateDatatype, rearrangeStructureVariables },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const { captureAndPush } = usePouSnapshot()

  const [tableData, setTableData] = useState<PLCStructureVariable[]>([])

  // Every open data type is mounted at once, so the view state comes from
  // this type's own model — never from the active `editor`.
  const model = editor.meta.name === dataTypeName ? editor : editors.find((e) => e.meta.name === dataTypeName)
  const modelStructure = model?.type === 'plc-datatype' ? model.structure : undefined
  const editorStructure: Extract<StructureTableType, { display: 'table' }> =
    modelStructure?.display === 'table'
      ? modelStructure
      : { display: 'table', selectedRow: ROWS_NOT_SELECTED.toString(), description: '' }

  useEffect(() => {
    const foundDataType = dataTypes.find(
      (dataType) => dataType?.derivation === 'structure' && dataType.name === dataTypeName,
    )

    if (foundDataType && 'variable' in foundDataType) {
      setTableData(foundDataType.variable)
    } else {
      return
    }
  }, [dataTypeName, dataTypes])

  const handleRowClick = (row: HTMLTableRowElement) => {
    updateModelStructureForName(dataTypeName, {
      selectedRow: parseInt(row.id),
    })
  }

  // `updateDatatype` is a full replace.  Read the current entry from
  // the store and spread it before writing so we don't strip any
  // field the structure schema may carry beyond `variable`.
  const writeVariables = (newVariables: PLCStructureVariable[]) => {
    const current = dataTypes.find((dt) => dt.name === dataTypeName)
    if (!current || current.derivation !== 'structure') return
    updateDatatype(dataTypeName, { ...current, variable: newVariables })
    handleFileAndWorkspaceSavedState(dataTypeName)
  }

  const handleCreateStructureVariable = () => {
    captureAndPush(dataTypeName)

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
      writeVariables([
        ...structureVariables,
        {
          name: getNextVariableName(baseName),
          type: { definition: 'base-type', value: 'DINT' },
          initialValue: { simpleValue: { value: '' } },
        },
      ])
      updateModelStructureForName(dataTypeName, {
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
      writeVariables([...structureVariables, newVariable])
      updateModelStructureForName(dataTypeName, {
        selectedRow: structureVariables.length,
      })
    } else {
      writeVariables([
        ...structureVariables.slice(0, selectedRow + 1),
        newVariable,
        ...structureVariables.slice(selectedRow + 1),
      ])
      updateModelStructureForName(dataTypeName, {
        selectedRow: selectedRow + 1,
      })
    }
  }

  const handleDeleteStructureVariable = () => {
    captureAndPush(dataTypeName)

    const structureVariables = tableData.filter((variable) => variable.name || variable.type)
    const selectedRow = parseInt(editorStructure.selectedRow)

    if (selectedRow === ROWS_NOT_SELECTED || selectedRow >= structureVariables.length) {
      return
    }

    const updatedVariables = [...structureVariables.slice(0, selectedRow), ...structureVariables.slice(selectedRow + 1)]

    writeVariables(updatedVariables)

    let newSelectedRow = selectedRow - 1
    if (newSelectedRow < 0 && updatedVariables.length > 0) {
      newSelectedRow = 0
    } else if (updatedVariables.length === 0) {
      newSelectedRow = ROWS_NOT_SELECTED
    }

    updateModelStructureForName(dataTypeName, {
      selectedRow: newSelectedRow,
    })
  }

  const handleRearrangeStructureVariables = (index: number, row?: number) => {
    captureAndPush(dataTypeName)

    rearrangeStructureVariables({
      associatedDataType: dataTypeName,
      rowId: row ?? parseInt(editorStructure.selectedRow),
      newIndex: (row ?? parseInt(editorStructure.selectedRow)) + index,
    })
    handleFileAndWorkspaceSavedState(dataTypeName)
    updateModelStructureForName(dataTypeName, {
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
        <div aria-label='structure base type container' className='flex w-1/2 flex-col gap-3'></div>
        <div aria-label='structure initial value container' className='w-1/2'></div>
      </div>
      <div className='flex h-full w-full flex-1 flex-col overflow-hidden'>
        <StructureTable
          dataTypeName={dataTypeName}
          tableData={tableData}
          selectedRow={parseInt(editorStructure.selectedRow)}
          handleRowClick={handleRowClick}
        />
      </div>
    </div>
  )
}

export { StructureDataType }
