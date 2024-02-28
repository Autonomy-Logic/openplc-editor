import React, { useState } from "react";
import { Panel } from "react-resizable-panels";
import { ArrowIcon, ArrowUp, MinusIcon, PlusIcon } from "~/renderer/assets";
import TableRoot from "./table";
import { TableIcon } from "~/renderer/assets/icons/interface/TableIcon";
import { CodeIcon } from "~/renderer/assets/icons/interface/CodeIcon";

export const VariableTable = () => {
  const optionsMock = [
    "BOOL",
    "SINT",
    "INT",
    "DINT",
    "LINT",
    "USINT",
    "UINT",
    "UDINT",
    "ULINT",
    "REAL",
    "LREAL",
    "TIME",
    "DATE",
    "TOD",
    "DT",
    "STRING",
    "BYTE",
    "WORD",
    "DWORD",
    "LWORD",
  ];
  const types = [
    {
      title: "Base Types",
      options: optionsMock,
    },
    {
      title: "User Data Types",
      options: optionsMock,
    },
    {
      title: "Native Data Types",
      options: ["LOGLEVEL"],
    },
    {
      title: "Function Block Types",
      options: optionsMock,
    },
    {
      title: "Array",
      options: optionsMock,
    },
  ];

  const classes = [
    { name: "input", value: "" },
    { name: "output", value: "" },
    { name: "inOut", value: "" },
    { name: "local", value: "" },
    { name: "local", value: "" },
    { name: "temporary", value: "" },
  ];

  const options = [
    { name: "constant", value: "" },
    { name: "variable", value: "" },
    { name: "function", value: "" },
  ];

  const [tableData, setTableData] = useState([
    {
      id: 1,
      name: "",
      class: classes,
      type: types,
      localization: "",
      initialValue: "",
      option: options,
      debug: "",
      documentation: "",
    },
  ]);

  const addTableRow = () => {
    const newRow = {
      id: tableData.length + 1,
      name: "",
      class: classes,
      type: types,
      localization: "",
      initialValue: "",
      option: options,
      debug: "",
      documentation: "",
    };
    setTableData([...tableData, newRow]);
  };

  const removeTableRow = (idToRemove) => {
    setTableData(tableData.filter((row) => row.id !== idToRemove));
  };

  return (
    <Panel defaultSize={35} className="flex flex-col gap-4 w-full h-full ">
      <div className="flex justify-between">
        <div className="flex gap-4">
          <div className="flex gap-4 items-center">
            Description:
            <input className="px-2 focus:outline-none w-80 border border-neutral-100 rounded-lg bg-inherit h-8" />
          </div>
          <div className="flex gap-4 items-center">
            Class Filter:
            <select className="px-2 focus:outline-none w-48 border border-neutral-100 rounded-lg bg-inherit h-8">
              <option value="local">Local</option>
            </select>
          </div>
        </div>
        <div className="flex gap-4">
          <div className="flex gap-3 items-center">
            <PlusIcon className="w-5 h-5 !stroke-brand" onClick={addTableRow} />
            <MinusIcon
              className="w-5 h-5 stroke-brand"
              onClick={() => removeTableRow(tableData.length)}
            />
            <ArrowUp className="w-5 h-5 stroke-brand" />
            <ArrowUp className="w-5 h-5 stroke-brand rotate-180" />
          </div>
          <div className="flex items-center rounded-md overflow-hidden">
            <TableIcon size="md" />
            <CodeIcon size="md" />
          </div>
        </div>
      </div>

      <TableRoot tableData={tableData} />
    </Panel>
  );
};
