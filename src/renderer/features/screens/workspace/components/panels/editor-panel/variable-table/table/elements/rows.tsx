import { useState } from "react";
import { cn } from "~/utils";
import ModalTypes from "../components/modal";

export default function TableRow({ row }) {
  const [showModal, setShowModal] = useState(false);

  const tdDefaultStyle =
    "h-8  font-medium text-neutral-500 text-xs w-[10%] !min-w-[128px]";
  const selectDefaultStyle =
    "w-full bg-inherit focus:outline-none text-center ";
  const optionDefaultStyle =
    "w-full bg-inherit focus:outline-none text-center rounded-2xl";
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
      <td className={tdDefaultStyle}>
        <select defaultValue="local" className={selectDefaultStyle}>
          {row.class.map((option, index) => (
            <option className={optionDefaultStyle} key={index}>
              {option.name}
            </option>
          ))}
        </select>
      </td>


      <td className={`${tdDefaultStyle} relative`}>
        <ModalTypes />
      </td>


      <td className={tdDefaultStyle}></td>
      <td className={tdDefaultStyle}>
        <input
          placeholder="initial value"
          type="text"
          className={selectDefaultStyle}
        />
      </td>
      <td className={tdDefaultStyle}>
        <select defaultValue="constant" className={selectDefaultStyle}>
          {row.option.map((option, index) => (
            <option className={optionDefaultStyle} key={index}>
              {option.name}
            </option>
          ))}
        </select>
      </td>
      <td className={tdDefaultStyle}></td>
      <td className={tdDefaultStyle}>
        <input type="text" className={selectDefaultStyle} />
      </td>
    </tr>
  );
}
