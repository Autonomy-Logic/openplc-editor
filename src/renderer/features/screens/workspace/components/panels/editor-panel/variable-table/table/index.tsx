import React from "react";

export default function TableRoot() {
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
    <div className="overflow-hidden  rounded-lg border border-neutral-300">
      <table className="w-full">
        <thead className="border-b border-neutral-300">
          <tr>
            {tableTitle.map((title) => (
              <th className="h-8 border-r px-4 py-2 text-center text-neutral-850 font-medium text-xs">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-300">
          <tr className="divide-x divide-neutral-300 ">
            {tableTitle.map((title) => (
              <td
                key={title}
                className="!h-8 px-3 font-medium text-neutral-500 text-xs"
              >
                <input
                  type="text"
                  className="w-full bg-inherit focus:outline-none text-center"
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
