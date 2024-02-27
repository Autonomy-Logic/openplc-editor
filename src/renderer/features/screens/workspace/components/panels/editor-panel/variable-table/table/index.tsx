import React from "react";

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
          {tableData.map((row, index) => (
            <tr key={index} className="divide-x divide-neutral-300">
              {tableTitle.map((title, i) => (
                <td
                  key={i}
                  className="!h-8 px-3 font-medium text-neutral-500 text-xs"
                >
                  {title === "#" ? (
                    <p className="text-neutral-400 text-center w-full">
                      {row.id}
                    </p>
                  ) : (
                    <input
                      type="text"
                      className="w-full bg-inherit focus:outline-none text-center"
                      value={row[title.toLowerCase().replace(/\s+/g, "")]}
                      onChange={(e) => console.log(e.target.value)}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
