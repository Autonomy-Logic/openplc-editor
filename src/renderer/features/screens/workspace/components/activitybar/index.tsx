import { useState } from "react";
import {
  SearchIcon,
  ZoomInOut,
  TransferIcon,
  DownloadIcon,
  PlayIcon,
  LightThemeIcon,
  DarkThemeIcon,
  ExitIcon,
  DebuggerIcon,
} from "~renderer/assets/icons";
import { ActivitybarButton } from "./components";
import { useNavigate } from "react-router-dom";

export default function Activitybar() {
  const navigate = useNavigate();

  return (
    <div className="bg-brand-dark dark:bg-neutral-950 h-full w-14 flex flex-col justify-between pb-10 border-t-inherit">
      <div className="w-full h-fit flex flex-col gap-10 my-5">
        <ActivitybarButton
          label="Search"
          Icon={SearchIcon}
          onClick={() => console.log("search")}
        />
        <ActivitybarButton
          label="Zoom"
          Icon={ZoomInOut}
          onClick={() => console.log("zoom")}
        />
        <ActivitybarButton
          label="Download"
          Icon={DownloadIcon}
          onClick={() => console.log("download")}
        />
        <ActivitybarButton
          label="Transfer"
          Icon={TransferIcon}
          onClick={() => console.log("transfer")}
        />
        <ActivitybarButton
          label="Debugger"
          Icon={DebuggerIcon}
          onClick={() => console.log("debugger")}
        />
        <ActivitybarButton
          label="Play"
          Icon={PlayIcon}
          onClick={() => console.log("play")}
        />
      </div>
      <div className=" h-20 w-full flex flex-col gap-6">
        <ActivitybarButton
          label="Exit"
          Icon={ExitIcon}
          onClick={() => navigate("/")}
        />
      </div>
    </div>
  );
}
