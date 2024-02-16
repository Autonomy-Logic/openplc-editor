import {
  ActivitySearchIcon,
  ActivityZoomInOut,
  ActivyTransferIcon,
  ActivityDownloadIcon,
  ActivityPlayIcon,
} from "../../assets/icons";

export default function Activitybar() {
  const items = [
    {
      icon: <ActivitySearchIcon />,
      title: "Search",
    },
    {
      icon: <ActivityZoomInOut />,
      title: "ActivityZoomInOut",
    },
    {
      icon: <ActivityDownloadIcon />,
      title: "ActivityDownloadIcon",
    },
    {
      icon: <ActivyTransferIcon />,
      title: "ActivyTransferIcon",
    },
    {
      icon: <ActivityPlayIcon />,
      title: "ActivityPlayIcon",
    },
  ];

  return (
    <div className="activitybar h-full w-20 bg-[#011E4B] flex flex-col justify-between pb-10">
      <div className=" w-full h-fit flex flex-col gap-6 my-5">
        {items.map((item, index) => (
          <div
            key={index}
            className="w-full h-10 flex items-center justify-center"
          >
            {item.icon}
          </div>
        ))}
      </div>
      <div className="bg-red-300 h-20 w-full"></div>
    </div>
  );
}
