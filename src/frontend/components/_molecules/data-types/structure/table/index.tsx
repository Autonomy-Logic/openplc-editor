import { createColumnHelper } from '@tanstack/react-table'

import type { PLCDataType, PLCStructureVariable } from '../../../../../../middleware/shared/ports/types'
import { usePouSnapshot } from '../../../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../../../store'
import { GenericTable } from '../../../../_atoms/generic-table'
import { EditableInitialValueCell, EditableNameCell } from './editable-cell'
import { SelectableTypeCell } from './selectable-cell'

const columnHelper = createColumnHelper<PLCStructureVariable>()

const columns = [
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

    cell: SelectableTypeCell,
  }),
  columnHelper.accessor('initialValue', {
    header: 'Initial Value',
    size: 64,

    cell: EditableInitialValueCell,
  }),
]

type PLCStructureTableProps = {
  tableData: PLCStructureVariable[]
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const StructureTable = ({ tableData, selectedRow, handleRowClick }: PLCStructureTableProps) => {
  const {
    editor,
    projectActions: { updateDatatype },
  } = useOpenPLCStore()

  const { captureAndPush } = usePouSnapshot()

  return (
    <GenericTable<PLCStructureVariable>
      columns={columns}
      tableData={tableData}
      selectedRow={selectedRow}
      handleRowClick={handleRowClick}
      updateData={(rowIndex, columnId, value) => {
        try {
          captureAndPush(editor.meta.name)

          updateDatatype(editor.meta.name, {
            derivation: 'structure',
            name: editor.meta.name,
            variable: tableData.map((variable, index) => {
              if (index === rowIndex) {
                return {
                  ...variable,
                  [columnId]: value,
                }
              }
              return variable
            }),
          } as unknown as PLCDataType)
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
