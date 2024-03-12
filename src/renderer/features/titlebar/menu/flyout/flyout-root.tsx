import * as Menubar from "@radix-ui/react-menubar";
import { ComponentProps, ReactNode } from "react";

type IFlyoutMenuRootProps = ComponentProps<typeof Menubar.Root> & {
  label: string;
  children: ReactNode;
};

export const FlyoutMenuRoot = (props: IFlyoutMenuRootProps) => {
  const { label, children } = props;
  return (
    <Menubar.Root>
      <Menubar.Menu>
        <Menubar.Trigger
          onClick={() => console.log(label)}
          className="w-fit h-fit px-2 py-px text-white font-caption font-light text-xs rounded-sm bg-brand-dark dark:bg-neutral-950  hover:bg-brand-medium-dark hover:shadow-2xl hover:dark:bg-neutral-900 transition-colors"
        >
          {label}
        </Menubar.Trigger>

        <Menubar.Portal>
          <Menubar.Content
            className="w-80 px-4 py-4 gap-2 bg-white dark:bg-neutral-900 dark:border-brand-dark rounded-md shadow-inner backdrop-blur-2xl border border-brand-light"
            align="start"
            sideOffset={3}
           
          >
            {children}
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>
    </Menubar.Root>
  );
};
