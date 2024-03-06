import React, { ComponentProps } from "react";
import { cn } from "~/utils";

type IDownloadIconProps = ComponentProps<"svg"> & {
  size?: "sm" | "md" | "lg";
};

const sizeClasses = {
  sm: "w-6 h-6",
  md: "w-8 h-8",
  lg: "w-10 h-10",
};

export const DownloadIcon = (props: IDownloadIconProps) => {
  const { className, size = "sm", ...res } = props;
  return (
    <svg
      role="button"
      viewBox="0 0 24 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.125 13.5338C11.0706 13.4929 11.0183 13.4476 10.9688 13.3981L9.11872 11.548C8.77701 11.2063 8.22299 11.2063 7.88128 11.548C7.53957 11.8897 7.53957 12.4437 7.88128 12.7855L9.73136 14.6355C10.9843 15.8885 13.0157 15.8885 14.2686 14.6355L16.1187 12.7855C16.4604 12.4437 16.4604 11.8897 16.1187 11.548C15.777 11.2063 15.223 11.2063 14.8813 11.548L13.0312 13.3981C12.9817 13.4476 12.9294 13.4929 12.875 13.5338V8.66673C12.875 8.18349 12.4832 7.79173 12 7.79173C11.5168 7.79173 11.125 8.18349 11.125 8.66673V13.5338Z"
        fill="#B4D0FE"
      />
      <path
        opacity="0.4"
        d="M23.6667 16.8333V8.66667C23.6667 6.08934 21.5773 4 19 4H15.8889C14.8792 4 13.8967 3.6725 13.0889 3.06667L10.9111 1.43333C10.1033 0.827497 9.12083 0.5 8.11111 0.5H4.99999C2.42267 0.5 0.333328 2.58934 0.333328 5.16667V16.8333C0.333328 19.4107 2.42267 21.5 4.99999 21.5H19C21.5773 21.5 23.6667 19.4107 23.6667 16.8333Z"
        fill="#B4D0FE"
      />
    </svg>
  );
};
