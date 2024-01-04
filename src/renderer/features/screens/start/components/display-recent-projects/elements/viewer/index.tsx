import * as ScrollArea from '@radix-ui/react-scroll-area';
import { HTMLAttributes, ReactNode } from 'react';

export type RecentViewerProps = HTMLAttributes<HTMLDivElement>;

export default function Viewer({ children }: RecentViewerProps): ReactNode {
  return (
    <ScrollArea.Root className='w-full h-[375px] overflow-auto rounded bg-none pb-2'>
      <ScrollArea.Viewport className='w-full h-screen mx-auto'>
        <div className='w-full h-screen grid grid-cols-4 pr-3 gap-4'>{children}</div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className='flex select-none touch-none p-[0.5px] w-1'>
        <ScrollArea.Thumb className="flex-1 bg-[#0350c9] rounded-[10px] relative before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:w-full before:h-full" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
