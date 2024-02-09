import { useLocation } from "react-router-dom";
import { useOpenPLCStore } from "~/renderer/store";

export default function Workspace() {
  // const location = useLocation();
  // console.log(location.pathname);

  // const { projectDataDraft, projectPathDraft } = useOpenPLCStore();

  return (
    <div className="containerWrapper bg-[#011E4B] flex h-full items-center w-full">
      <div className="activitybar h-full w-20 bg-[#011E4B]"></div>
      <div className="rounded-tl-lg flex-grow h-full bg-neutral-300 flex gap-2 p-2">
        <div className="sidebar h-full w-[200px] border-inherit rounded-lg overflow-hidden border-ne">
          <div className="projects h-[40%]  border-neutral-200 bg-white"></div>
          <hr className="h-[1px] bg-neutral-600 w-full" />
          <div className="h-[60%] border-neutral-200 bg-white"></div>
        </div>
        <div className="flex-grow h-full overflow-hidden flex flex-col gap-2">
          <div className="w-full h-[70px] border-neutral-200 rounded-lg bg-white"></div>
          <div className="flex-grow rounded-lg overflow-hidden flex flex-col ">
            <div className="w-full flex flex-col flex-grow">
              <div className="w-full h-[208px] border-neutral-200 bg-white"></div>
              <div className=" flex-grow w-full border-neutral-200 bg-white"></div>
            </div>
          </div>
          <div className="h-60 border-neutral-200 bg-white rounded-lg"></div>
        </div>
      </div>
    </div>
  );
}
