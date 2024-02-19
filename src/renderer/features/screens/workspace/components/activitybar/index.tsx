import {
  ActivitySearchIcon,
  ActivityZoomInOut,
  ActivyTransferIcon,
  ActivityDownloadIcon,
  ActivityPlayIcon,
  ActivityLightTheme,
} from "../../assets/icons";
import { ActivityExitIcon } from "../../assets/icons/interface/ActivityExit";

export default function Activitybar() {
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

  const bottomItems = [
    {
      icon: <ActivityLightTheme />,
      title: "ActivityLightTheme",
      onClick: () => {
        console.log("light");
      },
    },
    {
      icon: <ActivityExitIcon />,
      title: "ActivityExitIcon",
      onClick: () => {
        console.log("exit");
      },
    },
  ];

  return (
    <div className="activitybar h-full w-20 bg-[#011E4B] flex flex-col justify-between pb-10">
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
            onClick={item.onClick}
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
