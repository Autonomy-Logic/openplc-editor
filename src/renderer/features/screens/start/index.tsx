import {
	OpenIcon,
	PlusIcon,
	QuitIcon,
	TutorialsIcon,
} from '~renderer/assets/icons'
import { MenuComponent } from '~renderer/components/ui'

import {
	ActionsBar,
	Container,
	DisplayExampleProjects,
	DisplayRecentProjects,
} from './components'
import { useNavigate } from 'react-router-dom'
import { useOpenPLCStore } from '~renderer/store'
import { useCallback, useEffect } from 'react'
import { TXmlProject } from '~/shared/contracts/types'

export default function Start() {
  const navigate = useNavigate();
  const setWorkspaceData = useOpenPLCStore.useSetWorkspace();

  const handleOpenProject = async () => {
    const { ok, data } = await window.bridge.startOpenProject();
    if (ok && data) {
      const { path: projectPath, xmlAsObject: projectAsObj } = data;
      setWorkspaceData({ projectPath, projectData: projectAsObj });
      navigate("editor");
      console.log(data);
    }
  };

  return (
    <Container>
      <aside className="flex items-end w-full min-w-[240px]">
        <MenuComponent.Root>
          <MenuComponent.Section className="flex-col gap-2">
            <MenuComponent.Button
              label="New Project"
              icon={<PlusIcon />}
              className="w-48 h-12 text-white bg-brand rounded-md flex items-center hover:bg-brand-medium-dark focus:bg-brand-medium font-caption text-xl font-normal px-5 py-3 gap-3"
            />
            <MenuComponent.Button
              onClick={handleOpenProject}
              label="Open"
              icon={<OpenIcon />}
              className="w-48 h-12 text-neutral-1000 dark:text-white dark:hover:text-brand hover:text-brand bg-transparent flex items-center justify-start hover:opacity-90 font-caption text-xl font-medium py-3 gap-3"
            />
            <MenuComponent.Button
              label="Tutorials"
              icon={<TutorialsIcon />}
              className="w-48 h-12 text-neutral-1000 dark:text-white dark:hover:text-brand hover:text-brand bg-transparent flex items-center justify-start hover:opacity-90 font-caption text-xl font-medium py-3 gap-3"
            />
          </MenuComponent.Section>
          <MenuComponent.Divider />
          <MenuComponent.Section>
            <MenuComponent.Button
              label="Quit"
              icon={<QuitIcon />}
              className="w-48 h-12 text-neutral-1000 dark:text-white dark:hover:text-brand hover:text-brand bg-transparent flex items-center justify-start hover:opacity-90 font-caption text-xl font-medium py-3 gap-3"
            />
          </MenuComponent.Section>
        </MenuComponent.Root>
      </aside>
      <div>
        <ActionsBar />
        <DisplayExampleProjects />
        <DisplayRecentProjects />
      </div>
    </Container>
  );
}
