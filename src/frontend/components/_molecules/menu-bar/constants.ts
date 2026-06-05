const MenuClasses = {
  TRIGGER:
    'relative z-50 h-fit w-fit rounded-sm bg-brand-dark px-2 py-px font-caption text-xs font-light text-white transition-colors hover:bg-brand-medium-dark hover:shadow-2xl dark:bg-neutral-950 dark:hover:bg-neutral-900 aria-[expanded="true"]:bg-brand-medium dark:aria-[expanded="true"]:bg-neutral-900',
  CONTENT:
    'relative z-50 flex w-80 flex-col gap-2 rounded-md border border-brand-light bg-white px-4 py-4 shadow-inner drop-shadow-lg backdrop-blur-2xl dark:border-brand-dark dark:bg-neutral-900',
  ITEM: 'flex cursor-pointer items-center justify-between rounded-sm px-2 py-1 font-caption text-xs font-normal text-neutral-850 outline-none hover:bg-neutral-100 aria-[expanded="true"]:bg-neutral-100 dark:text-white dark:hover:bg-neutral-700 dark:aria-[expanded="true"]:bg-neutral-700 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent',
  ACCELERATOR: 'capitalize opacity-50',
  SEPARATOR: 'border-b border-b-neutral-400',
}

export { MenuClasses }
