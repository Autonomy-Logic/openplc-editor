import { Panel } from "react-resizable-panels";
import { ArrowIcon, ArrowUp, MinusIcon, PlusIcon } from "~/renderer/assets";
import TableRoot from "./table";

export const VariableTable = () => {
  return (
    <Panel defaultSize={35} className=" flex flex-col gap-4 w-full h-full ">
      <div className=" flex justify-between">
        <div className="flex gap-4">
          <div className="flex gap-4 items-center">
            Description:
            <input className="px-2 focus:outline-none w-80 border border-neutral-100 rounded-lg bg-inherit h-8" />
          </div>
          <div className="flex gap-4 items-center">
            Class Filter:
            <select className="px-2 focus:outline-none w-48 border border-neutral-100 rounded-lg bg-inherit h-8">
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
        </div>
        <div className="flex gap-4">
          <div className="flex gap-3">
            <PlusIcon className="w-5 h-5 !stroke-brand" />
            <MinusIcon className="w-5 h-5 stroke-brand" />
            <ArrowUp className="w-5 h-5 stroke-brand" />
            <ArrowUp className="w-5 h-5 stroke-brand rotate-180" />
          </div>
          <div>menu</div>
        </div>
      </div>
      {/** Table */}
      <TableRoot />
    </Panel>
  );
};
