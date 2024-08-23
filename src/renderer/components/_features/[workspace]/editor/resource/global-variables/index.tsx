import { VariablesTable } from '@root/renderer/components/_molecules'
import { PLCVariable } from '@root/types/PLC/open-plc'
import { ColumnFiltersState, OnChangeFn } from '@tanstack/react-table'
type PLCVariablesTableProps = {
  tableData: PLCVariable[]
  filterValue: string
  columnFilters?: ColumnFiltersState
  setColumnFilters?: OnChangeFn<ColumnFiltersState> | undefined
  selectedRow: number
  handleRowClick: (row: HTMLTableRowElement) => void
}
export default function GlobalVariables({
  tableData,
  filterValue,
  columnFilters,
  setColumnFilters,
  selectedRow,
  handleRowClick,
}: PLCVariablesTableProps) {
  return (
    <div>
      <VariablesTable
        tableData={tableData}
        filterValue={filterValue}
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        selectedRow={selectedRow}
        handleRowClick={handleRowClick}
      />
    </div>
  )
}
