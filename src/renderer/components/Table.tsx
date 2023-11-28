// /* eslint-disable react/function-component-definition */
// import {
//   ColumnDef,
//   flexRender,
//   getCoreRowModel,
//   Row,
//   RowData,
//   useReactTable,
// } from '@tanstack/react-table';
// import { FC, useMemo, useRef, useState } from 'react';
// import { useDrag, useDrop } from 'react-dnd';
// import { HiBars2, HiTrash } from 'react-icons/hi2';

// import { useFullScreen } from '@/hooks';
// import { classNames } from '@/utils';

// import Form from './Form';
// /**
//  * Props for the Table component.
//  */
// type TableProps<T> = {
//   columns: ColumnDef<T>[];
//   data: T[];
// };
// /**
//  * Data structure for variables in the table.
//  */
// export type VariablesTable = {
//   id: string;
//   name: string;
//   class: string;
//   type: string;
//   location: string;
//   initialValue: string;
//   option: string;
//   documentation: string;
// };
// /**
//  * Extend the TableMeta interface to include the updateData method.
//  */
// declare module '@tanstack/react-table' {
//   interface TableMeta<TData extends RowData> {
//     updateData: (rowIndex: number, columnId: string, value: unknown) => void;
//   }
// }

// // Give our default column cell renderer editing superpowers!
// /**
//  * Default cell renderer for table columns.
//  */
// const defaultColumn: Partial<ColumnDef<VariablesTable>> = {
//   cell: ({ getValue, row: { index }, column, table }) => {
//     const initialValue = getValue();

//     // return (
//     //   <Form.Field className="w-full min-w-full">
//     //     <Form.Input
//     //       defaultValue={initialValue as string}
//     //       type="text"
//     //       name={`variables`}
//     //     />
//     //   </Form.Field>
//     // )

//     return <input readOnly value={initialValue as string} />;
//   },
// };
// /**
//  * Define a draggable row component.
//  */
// const DraggableRow: FC<{
//   row: Row<VariablesTable>;
//   reorderRow: (draggedRowIndex: number, targetRowIndex: number) => void;
// }> = ({ row, reorderRow }) => {
//   /**
//    * Refs for drop and drag actions.
//    */
//   const trRef = useRef<HTMLTableRowElement>(null);

//   const [, dropRef] = useDrop({
//     accept: 'row',
//     drop: (draggedRow: Row<VariablesTable>) =>
//       reorderRow(draggedRow.index, row.index),
//   });

//   const [, dragRef, previewRef] = useDrag({
//     collect: (monitor) => ({
//       isDragging: monitor.isDragging(),
//     }),
//     item: () => row,
//     type: 'row',
//   });

//   previewRef(trRef);
//   /**
//    * Render draggable row with cells and buttons.
//    */
//   return (
//     <tr ref={trRef}>
//       {row.getVisibleCells().map((cell) => (
//         <td
//           key={cell.id}
//           className="whitespace-nowrap px-3 py-4 text-sm text-gray-500"
//         >
//           {flexRender(cell.column.columnDef.cell, cell.getContext())}
//         </td>
//       ))}
//       <td className="flex gap-4 whitespace-nowrap px-3 py-4 text-sm text-gray-500">
//         <button className="press-animated">
//           <HiTrash />
//         </button>
//         <button className="cursor-grab" ref={dragRef}>
//           <HiBars2 />
//         </button>
//       </td>
//     </tr>
//   );
// };
// /**
//  * Main Table component that displays the table.
//  * @returns a JSX component with the mounted table.
//  */
// const Table: FC = () => {
//   const { isFullScreen } = useFullScreen();
//   /**
//    * Define the table columns and initial data.
//    */
//   const columns = useMemo<ColumnDef<VariablesTable>[]>(
//     () => [
//       {
//         id: 'index',
//         header: '#',
//         cell: ({ row }) => <span className="">{row.index + 1}</span>,
//       },
//       {
//         header: 'Name',
//         accessorKey: 'name',
//       },
//       {
//         header: 'Class',
//         accessorKey: 'class',
//       },
//       {
//         header: 'Type',
//         accessorKey: 'type',
//       },
//       {
//         header: 'Location',
//         accessorKey: 'location',
//       },
//       {
//         header: 'Initial Value',
//         accessorKey: 'initialValue',
//       },
//       {
//         header: 'Option',
//         accessorKey: 'option',
//       },
//       {
//         header: 'Documentation',
//         accessorKey: 'documentation',
//       },
//     ],
//     [],
//   );

//   const [data, setData] = useState(
//     [...Array(50)].map((_, index) => ({
//       id: crypto.randomUUID(),
//       name: `LocalVar${index + 1}`,
//       class: 'Local',
//       type: 'DINT',
//       location: '',
//       initialValue: `${index * 3}`,
//       option: '',
//       documentation: '',
//     })),
//   );
//   /**
//    * Function to reorder rows.
//    */
//   const reorderRow = (draggedRowIndex: number, targetRowIndex: number) => {
//     data.splice(
//       targetRowIndex,
//       0,
//       data.splice(draggedRowIndex, 1)[0] as VariablesTable,
//     );
//     setData([...data]);
//   };
//   /**
//    * Get header groups and row model using useReactTable.
//    */
//   const { getHeaderGroups, getRowModel } = useReactTable({
//     data,
//     columns,
//     defaultColumn,
//     getCoreRowModel: getCoreRowModel(),
//   });

//   return (
//     <div
//       className={classNames(
//         isFullScreen ? 'h-[calc(100vh_-_8rem)]' : 'h-[calc(100vh_-_12rem)]',
//         'overflow-auto px-4',
//       )}
//     >
//       <table className="min-w-full divide-y divide-gray-300">
//         <thead className="sticky top-0 z-10 w-full border-b border-gray-300 bg-white dark:bg-gray-900">
//           {getHeaderGroups().map((headerGroup) => (
//             <tr key={headerGroup.id}>
//               {headerGroup.headers.map((header) => {
//                 return (
//                   <th
//                     className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
//                     key={header.id}
//                     colSpan={header.colSpan}
//                   >
//                     {header.isPlaceholder ? null : (
//                       <div>
//                         {flexRender(
//                           header.column.columnDef.header,
//                           header.getContext(),
//                         )}
//                       </div>
//                     )}
//                   </th>
//                 );
//               })}
//             </tr>
//           ))}
//         </thead>
//         <tbody className="w-full divide-y divide-gray-200">
//           {getRowModel().rows.map((row) => (
//             <DraggableRow key={row.id} row={row} reorderRow={reorderRow} />
//           ))}
//         </tbody>
//       </table>
//     </div>
//   );
// };

// export default Table;
