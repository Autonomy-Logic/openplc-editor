import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

export default function Workspace() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isBottomBarCollapsed, setIsBottomBarCollapsed] = useState(false);
  return (
    <div className="containerWrapper bg-[#011E4B] flex h-full items-center w-full">
      <div className="activitybar h-full w-20 bg-[#011E4B]"></div>
      <PanelGroup direction="horizontal">
        <div className="rounded-tl-lg flex-grow h-full bg-neutral-100 flex p-2 gap-1">
          <Panel
            onCollapse={() => setIsSidebarCollapsed(true)}
            onExpand={() => setIsSidebarCollapsed(false)}
            collapsible={true}
            collapsedSize={0}
            id="sidebar"
            minSize={11}
            defaultSize={11}
            className={` h-full border-inherit rounded-lg overflow-hidden border-2 border-neutral-200 ${
              isSidebarCollapsed ? "border-0" : ""
            }`}
          >
            <div className="projects h-[45%] border-neutral-200 bg-white"></div>
            <hr className="h-[1px] bg-neutral-600 w-full" />
            <div className="h-[55%] border-neutral-200 bg-white"></div>
          </Panel>

          <PanelResizeHandle
            className={`hover:bg-neutral-400 ${
              isSidebarCollapsed ? "hidden " : ""
            }  `}
          />

          <Panel>
            <PanelGroup
              className="flex-grow h-full overflow-hidden flex flex-col gap-1"
              direction="vertical"
            >
              <div className="w-full h-[70px] border-neutral-200 rounded-lg mb-1 bg-white border-2"></div>
              <Panel className="flex-grow rounded-lg overflow-hidden flex flex-col border-2 border-neutral-200">
                <div className="w-full flex flex-col flex-grow">
                  <div className="w-full h-[208px] border-neutral-200 bg-white"></div>
                  <div className="flex-grow w-full border-neutral-200 bg-white"></div>
                </div>
              </Panel>
              <PanelResizeHandle
                className={`hover:bg-neutral-400 ${
                  isBottomBarCollapsed ? "hidden " : ""
                } `}
              />
              <Panel
                onCollapse={() =>
                  setIsBottomBarCollapsed(true)
                }
                onExpand={() => setIsBottomBarCollapsed(false)}
                collapsible={true}
                collapsedSize={0}
                id="bottonbar"
                minSize={22}
                defaultSize={22}
                className={`border-neutral-200 bg-white rounded-lg border-2  ${
                  isBottomBarCollapsed ? "border-0 " : ""
                }`}
              ></Panel>
            </PanelGroup>
          </Panel>
        </div>
      </PanelGroup>
    </div>
  );
}
