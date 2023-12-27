import RecentProjects from '../../shared/data/mock/projects-data.json';
import { OpenIcon, PlusIcon, QuitIcon, TutorialsIcon } from '../assets/icons';
import RecentProjectViewer from '../components/recent-project';
import { MenuComponent } from '../components/ui';

function Draft() {
  return (
    <div className='w-full h-full bg-white flex justify-center items-center'>
      <div className='h-[600px]  w-48 flex flex-col justify-end py-24 mr-20'>
        <MenuComponent.Root>
          <MenuComponent.Section className='flex-col flex-grow justify-between'>
            <MenuComponent.Button
              className='w-full h-9 text-white  bg-[#0464FB] hover:opacity-90 rounded-md flex items-center'
              label='New Project'
              icon={<PlusIcon className='w-4 h-4 mx-2 my-2' />}
            />
            <MenuComponent.Button
              className='w-full flex items-center  gap-2'
              label='Open'
              icon={<OpenIcon className='w-6 h-fit' />}
            />
            <MenuComponent.Button
              className='w-full  flex items-center gap-2'
              label='Tutorials'
              icon={<TutorialsIcon className='w-6 h-fit' />}
            />
          </MenuComponent.Section>
          <MenuComponent.Divider />
          <MenuComponent.Section>
            <MenuComponent.Button
              className='  w-full flex items-center gap-2'
              label='Quit'
              icon={<QuitIcon className='w-6 h-fit' />}
            />
          </MenuComponent.Section>
        </MenuComponent.Root>
      </div>
      <RecentProjectViewer dataToRender={RecentProjects} />
    </div>
  );
}

export default Draft;
