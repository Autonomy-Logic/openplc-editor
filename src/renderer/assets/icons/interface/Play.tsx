import { ComponentProps } from "react";
import { cn } from "~/utils";

type IPlayIconProps = ComponentProps<"svg"> & {
  size?: "sm" | "md" | "lg";
};

const sizeClasses = {
  sm: "w-7 h-7",
  md: "w-10 h-10",
  lg: "w-14 h-14",
};

export const PlayIcon = (props: IPlayIconProps) => {
  const { className, size = "sm", ...res } = props;
  return (
    <svg
      role="button"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <path
        d="M3.14258 11V1.57143L19.6426 11L3.14258 20.4286V11Z"
        fill="#B4D0FE"
      />
    </svg>
  );
};
