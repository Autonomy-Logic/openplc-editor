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
import { MenuComponent, ActionsBar } from '../components/ui';

function Draft() {
  const options = [
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
    {
      label: 'Name',
      onClick: () => {
        console.log('option 3 clicked');
      },
    },
  ];
  const [selectedOption, setSelectedOption] = useState(options[0].label);
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
        <ActionsBar.ActionsRoot className={`w-full items-center flex gap-4 px-3 relative `}>
          <ActionsBar.DropDown>
            <ActionsBar.Select
              icon={<RecentsIcon />}
              selectedOption={selectedOption}
              setShowOptions={setShowOptions}
              showOptions={showOptions}
              placeholder='Order by'
            />
            <ActionsBar.Options
              className={`w-28  left-[92px] rounded-md h-fit bg-white border-[#EDEFF2] border-[2px] absolute z-[999] top-14 ${
                showOptions ? 'block' : 'hidden'
              }`}
              options={options}
              selectedOption={selectedOption}
              setSelectedOption={setSelectedOption}
              setShowOptions={setShowOptions}
            />
          </ActionsBar.DropDown>
          <ActionsBar.Search className='flex flex-grow border-[#EDEFF2] border-[2px] gap-2 rounded-lg text-base items-center h-12 '>
            <ActionsBar.Label
              htmlfor='startSearch'
              icon={<StartSearchIcon />}
              className='flex w-full h-full px-5 py-3 gap-5'
            >
              <ActionsBar.Input
                id='startSearch'
                className='w-full h-full bg-inherit outline-none text-black'
                type='text'
                placeholder='Search a project'
              />
            </ActionsBar.Label>
          </ActionsBar.Search>
        </ActionsBar.ActionsRoot>
        <RecentProjectViewer dataToRender={RecentProjects} />
      </div>
    </div>
  );
}

export default Draft;
