import { useState } from 'react';
import RecentProjects from '../../shared/data/mock/projects-data.json';
import {
  OpenIcon,
  PlusIcon,
  QuitIcon,
  RecentsIcon,
  StartSearchIcon,
  TutorialsIcon,
} from '../assets/icons';
import RecentProjectViewer from '../components/recent-project';
import { MenuComponent } from '../components/ui';
import ActionsOptions from '../components/ui/actions-bar/actions-options';
import ActionsRoot from '../components/ui/actions-bar/actions-root';
import ActionsSelect from '../components/ui/actions-bar/actions-select';

function Draft() {
  const options = [
    {
      label: 'most usageaaaaaaaaaaaa',
      onClick: () => {
        console.log('option 2 clicked');
      },
    },
    {
      label: 'Recent',
      onClick: () => {
        console.log('option 1 clicked');
      },
    },
    {
      label: 'Size',
      onClick: () => {
        console.log('option 2 clicked');
      },
    },
  ];

  const [selectedOptionLabel, setSelectedOptionLabel] = useState(options[0].label);
  const [showOptions, setShowOptions] = useState<boolean>(false);

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
      <div>
        <ActionsRoot>
          <ActionsSelect onClick={() => setShowOptions(!showOptions)}>
            <div className='flex items-center'>
              <span className='whitespace-nowrap overflow-hidden text-ellipsis w-36'>
                order by <span className='font-bold capitalize'>{selectedOptionLabel}</span>
              </span>
              <RecentsIcon className='absolute right-2' />
            </div>
          </ActionsSelect>
          <div
            className={`w-[180px] h-fit bg-white border-[#EDEFF2] border-[2px] absolute z-[999] top-14 ${
              showOptions ? 'block' : 'hidden'
            }`}
          >
            <ActionsOptions
              setShowOptions={setShowOptions}
              options={options}
              selectedOptionLabel={selectedOptionLabel}
              setSelectedOption={setSelectedOptionLabel}
            />
          </div>

          <div className='flex flex-grow gap-2 rounded-lg border-[#EDEFF2] border-[2px] items-center p-3'>
            <StartSearchIcon />
            Search a project
          </div>
        </ActionsRoot>
        <RecentProjectViewer dataToRender={RecentProjects} />
      </div>
    </div>
  );
}

export default Draft;
