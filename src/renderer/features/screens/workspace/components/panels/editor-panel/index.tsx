import { ReactNode, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import VariableTable from "./variable-table";
import { CodeEditor } from "./code-editor";

export const EditorPanel = (): ReactNode => {

  const [variableAsCode, setVariableAsCode] = useState(false);

  return (
    <Panel className="flex-grow rounded-lg overflow-hidden flex flex-col border-2 border-neutral-200 bg-white dark:bg-neutral-950 dark:border-neutral-800 p-4">
      <PanelGroup
        className="w-full h-full flex flex-col gap-2 "
        direction="vertical"
      >
        <VariableTable />
        <div className="w-full flex justify-center ">
          <PanelResizeHandle
            title="Resize"
            className="h-[1px] bg-brand-light w-full"
          ></PanelResizeHandle>
        </div>
        <CodeEditor />
      </PanelGroup>
    </Panel>
  );
};
