import { HTMLAttributes } from 'react';

import { FileElement } from '@/renderer/components/elements';
import { ScrollAreaComponent } from '@/renderer/components/ui';

import RecentProjects from '../../../../../../shared/data/mock/projects-data.json';
import { Header, Wrapper } from './elements';

export type DisplayRecentProjectProps = HTMLAttributes<HTMLDivElement>;

export default function DisplayRecentProjects() {
  return (
    <Wrapper>
      <Header title='Projects' />
      <ScrollAreaComponent.Root className='h-[350px] w-full rounded-md'>
        <ScrollAreaComponent.Viewport>
          <ScrollAreaComponent.CustomDisplay>
            {RecentProjects.map((project) => (
              <FileElement.Root key={project.id}>
                <FileElement.Label
                  projectName={project.name}
                  lastModified={project.last_modified}
                />
                <FileElement.Shape />
              </FileElement.Root>
            ))}
          </ScrollAreaComponent.CustomDisplay>
        </ScrollAreaComponent.Viewport>
        <ScrollAreaComponent.ScrollBar />
      </ScrollAreaComponent.Root>
    </Wrapper>
  );
}

export type DisplayRecentProjectsComponent = typeof DisplayRecentProjects;
