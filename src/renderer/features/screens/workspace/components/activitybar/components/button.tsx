import { ComponentProps, ElementType } from "react";

type IActivitybarButtonProps = ComponentProps<"button"> & {
  label: string;
  Icon: ElementType;
};

export const ActivitybarButton = ({
  label,
  Icon,
  ...res
}: IActivitybarButtonProps) => {
  return (
    <button
      type="button"
      title={label}
      className="w-full h-8 flex items-center justify-center"
      {...res}
    >
      <Icon />
      <span className="sr-only">{label}</span>
    </button>
  );
};
