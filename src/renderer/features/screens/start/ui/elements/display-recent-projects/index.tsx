import { HTMLAttributes } from 'react';

import { FileElement } from '@/renderer/components/elements';

import RecentProjects from '../../../shared/data/mock/projects-data.json';
import { Header, Viewer, Wrapper } from './components';

export type DisplayRecentProjectProps = HTMLAttributes<HTMLDivElement>;

export default function DisplayRecentProjects() {
  return (
    <Wrapper>
      <Header title='Projects' />
      <Viewer>
        {RecentProjects.map((project) => (
          <FileElement.Root key={project.id}>
            <FileElement.Label projectName={project.name} lastModified={project.last_modified} />
            <FileElement.Shape />
          </FileElement.Root>
        ))}
      </Viewer>
    </Wrapper>
  );
}

export type DisplayRecentProjectsComponent = typeof DisplayRecentProjects;
