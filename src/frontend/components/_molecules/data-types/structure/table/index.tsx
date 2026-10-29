import { createColumnHelper } from '@tanstack/react-table'
import { useMemo } from 'react'

import type { PLCStructureVariable } from '../../../../../../middleware/shared/ports/types'
import { usePouSnapshot } from '../../../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../../../store'
import { GenericTable } from '../../../../_atoms/generic-table'
import { EditableInitialValueCell, EditableNameCell } from './editable-cell'
import { SelectableTypeCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCStructureVariable>()

type PLCStructureTableProps = {
  dataTypeName: string
  tableData: PLCStructureVariable[]
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const StructureTable = ({ dataTypeName, tableData, selectedRow, handleRowClick }: PLCStructureTableProps) => {
  const {
    project: {
      data: { dataTypes },
    },
    projectActions: { updateDatatype },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
  } = useOpenPLCStore()

  const { captureAndPush } = usePouSnapshot()

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'rowNumber',
        header: '#',
        size: 64,

        enableResizing: true,
        cell: (props) => props.row.index,
      }),
      columnHelper.accessor('name', {
        header: 'Name',
        size: 150,

        cell: EditableNameCell,
      }),
      columnHelper.accessor('type', {
        header: 'Type',
        size: 64,

        cell: (props) => <SelectableTypeCell {...props} dataTypeName={dataTypeName} />,
      }),
      columnHelper.accessor('initialValue', {
        header: 'Initial Value',
        size: 64,

        cell: EditableInitialValueCell,
      }),
    ],
    [dataTypeName],
  )

  return (
    <GenericTable<PLCStructureVariable>
      columns={columns}
      tableData={tableData}
      selectedRow={selectedRow}
      handleRowClick={handleRowClick}
      updateData={(rowIndex, columnId, value) => {
        try {
          // `updateDatatype` is a full replace — pull the current
          // entry from the store and spread it so we don't strip
          // any field beyond the one we're editing.
          const current = dataTypes.find((dt) => dt.name === dataTypeName)
          if (!current || current.derivation !== 'structure') {
            return { ok: false, title: 'Update Failed', message: 'Structure datatype not found.' }
          }

          captureAndPush(dataTypeName)

          updateDatatype(dataTypeName, {
            ...current,
            variable: tableData.map((variable, index) => {
              if (index === rowIndex) {
                return {
                  ...variable,
                  [columnId]: value,
                }
              }
              return variable
            }),
          })
          handleFileAndWorkspaceSavedState(dataTypeName)
          return { ok: true, message: 'Data updated successfully.' }
        } catch (error) {
          console.error('Failed to update data:', error)
          return {
            ok: false,
            title: 'Update Failed',
            message: 'An error occurred while updating the data.',
            data: error,
          }
        }
      }}
      tableContext='Structure'
    />
  )
}

export { StructureTable }
