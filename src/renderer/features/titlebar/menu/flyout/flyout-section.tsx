import { ComponentProps } from "react";
import { cn } from "~/utils";
import * as Menubar from "@radix-ui/react-menubar";

type IMenuSectionProps = ComponentProps<"ul"> & {
  section: IMenuItem[];
  hasSibling?: boolean;
};

type IMenuItem = ComponentProps<"li"> & {
  id: string;
  label: string;
  action?: () => void;
  accelerator?: string;
};

export const FlyoutMenuSection = (props: IMenuSectionProps) => {
  const { section, hasSibling = false, ...res } = props;

  return (
    <ul
      className={cn(
        "w-full flex flex-col gap-2",
        `${hasSibling && "border-b border-b-neutral-400 mb-2 pb-2"}`,
      )}
      {...res}
    >
      {section?.map((item) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: This is not useful in this context
        <li
          key={item.label}
          className="px-2 py-1 text-neutral-850 outline-none font-normal font-caption text-xs dark:text-white flex items-center justify-between hover:bg-neutral-100 hover:dark:bg-neutral-700 rounded-sm cursor-pointer"
          onClick={item.action}
        >
          {item.submenu ? (
            <div className="w-full flex justify-between">
              <Menubar.Sub>
                <Menubar.SubTrigger className="w-full h-full outline-none text-neutral-850 font-normal font-caption text-xs dark:text-white flex items-center justify-between hover:bg-neutral-100 hover:dark:bg-neutral-700 rounded-sm cursor-pointer">
                  {item.label}
                  {item.submenu.map((sub) =>
                    sub.selected ? (
                      <span className="opacity-50 ">{sub.label}</span>
                    ) : null,
                  )}
                </Menubar.SubTrigger>

                <Menubar.Portal>
                  <Menubar.SubContent
                    className="w-80 px-4 py-4 gap-2 bg-white dark:bg-neutral-900 dark:border-brand-dark rounded-md shadow-inner backdrop-blur-2xl border border-brand-light"
                    alignOffset={-10}
                  >
                    {item.submenu.map(
                      (sub) => (
                        console.log(sub),
                        (
                          <Menubar.Item
                            onClick={() => (sub.action() ? sub.action() : null)}
                            className="flex px-2  outline-none  justify-between items-center text-neutral-850 dark:text-white my-2 hover:bg-neutral-100 hover:dark:bg-neutral-700 rounded-sm cursor-pointer"
                            key={sub.label}
                          >
                            {sub.label}
                            <div className="w-3 h-3 bg-neutral-300 dark:bg-neutral-100 items-center flex">
                              {sub.selected ? (
                                <span className="text-brand">✓</span>
                              ) : null}
                            </div>
                          </Menubar.Item>
                        )
                      ),
                    )}
                  </Menubar.SubContent>
                </Menubar.Portal>
              </Menubar.Sub>
            </div>
          ) : (
            <span>{item.label}</span>
          )}
          <span className="opacity-40">{item.accelerator}</span>
        </li>
      ))}
    </ul>
  );
};
