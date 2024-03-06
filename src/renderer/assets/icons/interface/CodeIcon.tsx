import { ComponentProps } from "react";
import { cn } from "~/utils";

type ICodeIconProps = ComponentProps<"svg"> & {
  size?: "sm" | "md" | "lg";
  variableAsCode?: boolean;
};
const sizeClasses = {
  sm: "w-7 h-7",
  md: "w-10 h-10",
  lg: "w-14 h-14",
};

export const CodeIcon = (props: ICodeIconProps) => {
  const { variableAsCode, className, size = "sm", ...res } = props;

  return (
    <svg
      role="button"
      viewBox="0 0 30 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <rect
        width="30"
        height="28"
        fill={variableAsCode ? "#0464FB" : "#EDEFF2"}
      />
      <path
        d="M18.3333 17.3333L21.6667 14L18.3333 10.6667M11.6667 10.6667L8.33333 14L11.6667 17.3333M16.3333 8L13.6667 20"
        stroke={variableAsCode ? "white" : "#C8D0D9"}
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};
