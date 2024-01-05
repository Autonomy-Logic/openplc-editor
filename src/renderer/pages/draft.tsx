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
import { ActionsBar, MenuComponent } from '../components/ui';

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
      <div className='flex flex-col items-center'>
        <ActionsBar.ActionsRoot
          className={`w-[968px] items-center flex justify-between  relative `}
        >
          <ActionsBar.DropDown>
            <ActionsBar.Select
              className='w-60 gap-3 whitespace-nowrap text-base justify-center pl-6 pr-2 relative flex items-center rounded-lg  border-[#EDEFF2] border-[2px] h-14 cursor-pointer '
              icon={<RecentsIcon />}
              selectedOption={selectedOption}
              setShowOptions={setShowOptions}
              showOptions={showOptions}
              placeholder='Order by'
            />
            <ActionsBar.Options
              className={`w-[138px]  right-0 rounded-md  bg-white border-[#EDEFF2] border-[1.5px] absolute z-[999] top-16 ${
                showOptions ? 'block' : 'hidden'
              }`}
              options={options}
              setSelectedOption={setSelectedOption}
              setShowOptions={setShowOptions}
              selectedOption={selectedOption}
            />
          </ActionsBar.DropDown>
          <ActionsBar.Search className='flex w-[704px] border-[#EDEFF2] border-[1.5px] gap-2 rounded-lg text-base items-center h-14 '>
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

/* <div className='relative flex flex-col items-start justify-start gap-6 text-left text-xl text-black w-full bg-white'>
        <div className='flex flex-row items-start self-stretch justify-between'>
          <h3 className='relative leading-6 font-medium'>Examples</h3>
          <div className='flex flex-row flex-shrink-0 items-start justify-start gap-6'>
            <img
              alt='icon for nav left'
              className='relative flex-shrink-0 w-6 h-6 overflow-hidden object-cover'
              src={LeftArrow}
            />
            <img
              alt='icon for nav right'
              className='relative flex-shrink-0 w-6 h-6 overflow-hidden object-contain'
              src={RightArrow}
            />
          </div>
        </div>
        <div className='flex flex-row self-stretch items-start justify-start gap-6 overflow-auto'>
          {DataForExamples.map((ex) => (
            <Card.Root key={ex.example_id}>
              <Card.Preview source={TestImage} />
              <Card.Label title={ex.example_name} description={ex.example_description} />
            </Card.Root>
          ))}
        </div>
      </div> */
