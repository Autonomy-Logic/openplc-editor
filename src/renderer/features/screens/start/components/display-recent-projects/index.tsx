import { HTMLAttributes } from "react";

import { FileElement } from "~renderer/components/elements";
import { ScrollAreaComponent } from "~renderer/components/ui";

import RecentProjects from "../../../../../../shared/data/mock/projects-data.json";
import { Header, Wrapper } from "./elements";

export type DisplayRecentProjectProps = HTMLAttributes<HTMLDivElement>;

export default function DisplayRecentProjects() {
  return (
    <Wrapper>
      <Header title="Projects" />
      <div className="grid  grid-cols-3  xl:grid-cols-4 xxl:grid-cols-5  w-auto h-[528px] overflow-auto ">
        {RecentProjects.map((project) => (
          <FileElement.Root
            key={project.id}
            className="mb-8 "
          >
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
