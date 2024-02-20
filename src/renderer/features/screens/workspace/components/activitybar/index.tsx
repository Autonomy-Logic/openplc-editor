import { useCallback, useEffect, useState } from "react";
import {
  ActivitySearchIcon,
  ActivityZoomInOut,
  ActivyTransferIcon,
  ActivityDownloadIcon,
  ActivityPlayIcon,
  ActivityLightTheme,
  DarkThemeIcon
} from "../../assets/icons";
import { ActivityExitIcon } from "../../assets/icons/interface/ActivityExit";


export default function Activitybar() {
  const [theme, setTheme] = useState("light");
  const topItems = [
    {
      icon: <ActivitySearchIcon />,
      title: "Search",
      onClick: () => {
        console.log("search");
      },
    },
    {
      icon: <ActivityZoomInOut />,
      title: "ActivityZoomInOut",
      onClick: () => {
        console.log("zoom");
      },
    },
    {
      icon: <ActivityDownloadIcon />,
      title: "ActivityDownloadIcon",
      onClick: () => {
        console.log("download");
      },
    },
    {
      icon: <ActivyTransferIcon />,
      title: "ActivyTransferIcon",
      onClick: () => {
        console.log("transfer");
      },
    },
    {
      icon: <ActivityPlayIcon />,
      title: "ActivityPlayIcon",
      onClick: () => {
        console.log("play");
      },
    },
  ];

  const handleSetTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    window.bridge.toggleTheme();
  };

  const bottomItems = [
    {
      icon: theme === "light" ? <ActivityLightTheme /> : <DarkThemeIcon />,
      title: theme === "light" ? "ActivityLightTheme" : "ActivityDarkTheme",
    },
    {
      icon: <ActivityExitIcon />,
      title: "ActivityExitIcon",
    },
  ];

  return (
    <div className=" dark:bg-neutral-950 bg-brand-dark h-full w-20 flex flex-col justify-between pb-10">
      <div className=" w-full h-fit flex flex-col gap-6 my-5">
        {topItems.map((item, index) => (
          <div
            onClick={item.onClick}
            key={index}
            className="w-full h-10 flex items-center justify-center"
          >
            {item.icon}
          </div>
        ))}
      </div>
      <div className=" h-20 w-full flex flex-col gap-3">
        {bottomItems.map((item, index) => (
          <div
            onClick={() => handleSetTheme()}
            key={index}
            className="w-full h-10 flex items-center justify-center"
          >
            {item.icon}
          </div>
        ))}
      </div>
    </div>
  );
}
