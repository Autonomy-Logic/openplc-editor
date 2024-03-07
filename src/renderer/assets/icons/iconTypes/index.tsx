import { ComponentProps } from "react";

export type IIconProps = ComponentProps<"svg"> & {
  size?: "sm" | "md" | "lg";
};
