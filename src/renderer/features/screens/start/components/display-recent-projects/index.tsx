import { HTMLAttributes, useEffect, useState } from "react";
import { FileElement } from "~renderer/components/elements";
import RecentProjects from "../../../../../../shared/data/mock/projects-data.json";
import { Header, Wrapper } from "./elements";

export type DisplayRecentProjectProps = HTMLAttributes<HTMLDivElement>;

const initialHeight = 608;
const heightIncrement = 184;
const initialContainerHeight = 160;

export default function DisplayRecentProjects() {
  const [containerHeight, setContainerHeight] = useState(
    initialContainerHeight,
  );

  const calculateHeight = (screenHeight: number) => {
    const baseHeight = initialHeight;
    const adjustedHeight =
      Math.floor((screenHeight - baseHeight) / heightIncrement) *
        heightIncrement +
      initialContainerHeight;
    return Math.max(initialContainerHeight, adjustedHeight);
  };

  const updateContainerHeight = () => {
    const screenHeight = window.innerHeight;
    const newHeight = calculateHeight(screenHeight);
    setContainerHeight(newHeight);
  };

  useEffect(() => {
    updateContainerHeight();
    window.addEventListener("resize", updateContainerHeight);

    return () => {
      window.removeEventListener("resize", updateContainerHeight);
    };
  }, []);

  console.log("containerHeight", containerHeight);
  console.log("window.innerHeight", window.innerHeight);


  return (
    <Wrapper>
      <Header title="Projects" />
      <div
        className={`grid grid-cols-3 gap-y-6 xl:grid-cols-4 xxl:grid-cols-5 overflow-auto`}
        style={{ height: `${containerHeight}px` }}
      >
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
