import { HTMLAttributes, useEffect, useState } from "react";
import { FileElement } from "~renderer/components/elements";
import RecentProjects from "../../../../../../shared/data/mock/projects-data.json";
import { Header, Wrapper } from "./elements";

export type DisplayRecentProjectProps = HTMLAttributes<HTMLDivElement>;

export default function DisplayRecentProjects() {
  return (
    <Wrapper>
      <Header title="Projects" />
      <div className='flex flex-wrap gap-6 overflow-auto h-full'>
        {RecentProjects.map((project) => (
          <FileElement.Root key={project.id}>
            <FileElement.Label
              projectName={project.name}
              lastModified={project.last_modified}
            />
            <FileElement.Shape />
          </FileElement.Root>
        ))}
      </div>
    </Wrapper>
  );
}

export type DisplayRecentProjectsComponent = typeof DisplayRecentProjects;
