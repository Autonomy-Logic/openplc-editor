import * as Viewer from '@radix-ui/react-scroll-area';
import { HTMLAttributes, ReactNode } from 'react';

import { FileElement } from '../elements';

type ProjectData = {
  project_id: string;
  project_name: string;
  last_modified: string;
};

type RecentProjectViewerProps = HTMLAttributes<HTMLDivElement> & {
  dataToRender: ProjectData[];
};

export default function RecentProjectViewer({ dataToRender }: RecentProjectViewerProps): ReactNode {
  return (
    <Viewer.Root className='w-[994px] h-[600px] overflow-hidden rounded bg-white py-2'>
      <Viewer.Viewport className='w-full h-full container mx-auto'>
        <div className='w-full h-full grid grid-cols-5 px-3 gap-4'>
          {dataToRender.map((project) => (
            <FileElement.Root key={project.project_id}>
              <FileElement.Label
                projectName={project.project_name}
                lastModified={project.last_modified}
              />
              <FileElement.Shape />
            </FileElement.Root>
          ))}
        </div>
      </Viewer.Viewport>
      <Viewer.Scrollbar className='flex select-none touch-none p-[0.5px] w-1'>
        <Viewer.Thumb className="flex-1 bg-[#0350c9] rounded-[10px] relative before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:w-full before:h-full" />
      </Viewer.Scrollbar>
    </Viewer.Root>
  );
}
