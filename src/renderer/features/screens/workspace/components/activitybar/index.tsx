import { useState } from "react";
import {
  ActivitySearchIcon,
  ActivityZoomInOut,
  ActivyTransferIcon,
  ActivityDownloadIcon,
  ActivityPlayIcon,
  ActivityLightTheme,
  DarkThemeIcon,
} from "../../assets/icons";
import { ActivityExitIcon } from "../../assets/icons/interface/ActivityExit";

export default function Activitybar() {
  const prefersDarkMode =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  const [theme, setTheme] = useState(prefersDarkMode);

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

  const handleSetTheme = async () => {
    const res = await window.bridge.toggleTheme();
    setTheme(res);
  };

  const bottomItems = [
    {
      key: "theme",
      icon: theme === true ? <DarkThemeIcon /> : <ActivityLightTheme />,
      title: theme === true ? "ActivityLightTheme" : "ActivityDarkTheme",
    },
    {
      key: "exit",
      icon: <ActivityExitIcon />,
      title: "ActivityExitIcon",
    },
  ];
  console.log(theme);
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
            key={index}
            className="w-full h-10 flex items-center justify-center"
          >
            {item.key === "theme" ? (
              <div onClick={handleSetTheme}> {item.icon}</div>
            ) : (
              item.icon
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
