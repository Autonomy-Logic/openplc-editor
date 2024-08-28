import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../_atoms'

export default function TaskTable() {
  return (
    <Table context='Tasks' className='mr-1'>
      <TableHeader>
        <TableRow>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow className='h-8 cursor-pointer'>
          <TableCell></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
