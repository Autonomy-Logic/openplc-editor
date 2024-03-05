import { useState } from "react";
import { cn } from "~/utils";
import DropdownTypes from "../components/typesDropdown";
import OptionsDropdown from "../components/optionsDropdown";

export default function TableRow({ row }) {
  const tdDefaultStyle =
    "h-8  font-medium text-neutral-500 text-xs w-[10%] !min-w-[128px]";
  const selectDefaultStyle =
    "w-full bg-inherit focus:outline-none text-center ";

  return (
    <tr className=" divide-x divide-neutral-300 ">
      <td className={cn(tdDefaultStyle, "w-[6%]")}>
        <p className="text-neutral-400 text-center w-full">{row.id}</p>
      </td>
      <td className={tdDefaultStyle}>
        <input
          type="text"
          className={selectDefaultStyle}
          defaultValue={`localVar${row.id}`}
          onChange={(e) => console.log(e.target.value)}
        />
      </td>
      <td className={`${tdDefaultStyle} `}>
        <DropdownTypes row={row} value="class" />
      </td>

      <td className={`${tdDefaultStyle} `}>
        <DropdownTypes row={row}  value="type"/>
      </td>

      <td className={tdDefaultStyle}></td>
      <td className={tdDefaultStyle}>
        <input
          placeholder="initial value"
          type="text"
          className={selectDefaultStyle}
        />
      </td>
      <td className={`${tdDefaultStyle}`}>
        <DropdownTypes row={row} value="option" />
      </td>
      <td className={tdDefaultStyle}></td>
      <td className={tdDefaultStyle}>
        <input type="text" className={selectDefaultStyle} />
      </td>
    </tr>
  );
}
