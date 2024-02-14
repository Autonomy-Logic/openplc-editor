import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

export default function Workspace() {
  return (
    <div className="containerWrapper bg-[#011E4B] flex h-full items-center w-full">
      <div className="activitybar h-full w-20 bg-[#011E4B]"></div>
      <PanelGroup direction="horizontal">
        <div className="rounded-tl-lg flex-grow h-full bg-neutral-300 flex p-2 gap-1">
          <Panel
            collapsible={true}
            collapsedSize={0}
            id="sidebar"
            minSize={10}
            defaultSize={11}
            className={` h-full border-inherit rounded-lg overflow-hidden `}
          >
            <div className="projects h-[40%] border-neutral-200 bg-white"></div>
            <hr className="h-[1px] bg-neutral-600 w-full" />
            <div className="h-[60%] border-neutral-200 bg-white"></div>
          </Panel>

          <PanelResizeHandle className={`hover:bg-neutral-400  `} />

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
              <PanelResizeHandle className={`hover:bg-neutral-400`} />
              <Panel
                collapsible={true}
                collapsedSize={0}
                id="bottonbar"
                minSize={21}
                defaultSize={22}
                className={`border-neutral-200 bg-white rounded-lg`}
              ></Panel>
            </PanelGroup>
          </Panel>
        </div>
      </PanelGroup>
    </div>
  );
}
