import { ComponentProps } from "react";
import { cn } from "~/utils";

type IActivityExitProps = ComponentProps<"svg"> & {
  size?: "sm" | "md" | "lg";
};
const sizeClasses = {
  sm: "w-7 h-7",
  md: "w-10 h-10",
  lg: "w-14 h-14",
};

export const ActivityExitIcon = (props: IActivityExitProps) => {
  const { className, size = "sm", ...res } = props;

  return (
    <svg
      role="button"
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <path
        d="M5.8335 14L22.1668 14M5.8335 14L12.6391 21M5.8335 14L12.6391 7"
        stroke="#B4D0FE"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
