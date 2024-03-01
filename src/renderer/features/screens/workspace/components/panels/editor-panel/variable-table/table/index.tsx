import TableHeader from "./elements/header";
import TableRow from "./elements/rows";

export default function TableRoot({ tableData }) {
  const tableTitle = [
    "#",
    "Name",
    "Class",
    "Type",
    "Localization",
    "Initial value",
    "Option",
    "Debug",
    "Documentation",
  ];

  return (
    <div className=" rounded-lg border border-neutral-300 overflow-auto scroll-mt-2">
      <table className="w-full ">
        <thead className="border-b border-neutral-300">
          <tr>
            {tableTitle.map((title) => (
              <TableHeader key={title} title={title} />
            ))}
          </tr>
        </thead>
        <tbody className=" divide-y divide-neutral-300">
          {tableData.map((row, index) => (
            <TableRow key={index} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
