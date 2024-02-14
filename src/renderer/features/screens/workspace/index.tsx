import React, { useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

export default function Workspace() {
  const [sidebarSize, setSidebarSize] = useState(11);
  const [bottonbarSize, setBottonbarSize] = useState(22);

  useEffect(() => {
    setSidebarSize(prevSize => (prevSize < 11 ? 10 : prevSize));
  }, []);

  useEffect(() => {
    setBottonbarSize(prevSize => (prevSize < 22 ? 21 : prevSize));
  }, []);

  return (
    <div className="containerWrapper bg-[#011E4B] flex h-full items-center w-full">
      <div className="activitybar h-full w-20 bg-[#011E4B]"></div>
      <PanelGroup direction="horizontal">
        <div className="rounded-tl-lg flex-grow h-full bg-neutral-300 flex p-2">
          <Panel
            onResize={setSidebarSize}
            id="sidebar"
            minSize={10}
            defaultSize={sidebarSize}
            className={`sidebar h-full border-inherit rounded-lg overflow-hidden ${sidebarSize < 11 ? "hidden" : ""}`}
          >
            <div className="projects h-[40%] border-neutral-200 bg-white"></div>
            <hr className="h-[1px] bg-neutral-600 w-full" />
            <div className="h-[60%] border-neutral-200 bg-white"></div>
          </Panel>
          <PanelResizeHandle className="hover:bg-neutral-400 w-2" />
          <Panel>
            <PanelGroup
              className="flex-grow h-full overflow-hidden flex flex-col gap-1"
              direction="vertical"
            >
              <div className="w-full h-[70px] border-neutral-200 rounded-lg mb-1 bg-white"></div>
              <Panel className="flex-grow rounded-lg overflow-hidden flex flex-col">
                <div className="w-full flex flex-col flex-grow">
                  <div className="w-full h-[208px] border-neutral-200 bg-white"></div>
                  <div className="flex-grow w-full border-neutral-200 bg-white"></div>
                </div>
              </Panel>
              <PanelResizeHandle />
              <Panel
                onResize={setBottonbarSize}
                id="bottonbar"
                minSize={21}
                defaultSize={bottonbarSize}
                className={`border-neutral-200 bg-white rounded-lg ${bottonbarSize < 22 ? "hidden" : ""}`}
              ></Panel>
            </PanelGroup>
          </Panel>
        </div>
      </PanelGroup>
    </div>
  );
}
