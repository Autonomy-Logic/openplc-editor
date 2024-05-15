import { type IVariable } from '@root/types/PLC'
import { ColumnDef } from '@tanstack/react-table'

export const columns: ColumnDef<IVariable>[] = [
  { accessorKey: 'id', header: '#' },
  {
    accessorKey: 'name',
    header: 'Name',
  },
  {
    accessorKey: 'class',
    header: 'Class',
  },
  {
    accessorKey: 'type',
    header: 'Type',
  },
  {
    accessorKey: 'location',
    header: 'Location',
  },
  {
    accessorKey: 'initialValue',
    header: 'Initial Value',
  },
  {
    accessorKey: 'debug',
    header: 'Debug',
  },
  {
    accessorKey: 'documentation',
    header: 'Documentation',
  },
]
