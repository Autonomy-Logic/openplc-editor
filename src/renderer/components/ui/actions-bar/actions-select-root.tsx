import React, { useState } from 'react';
import ActionsSelect from './actions-select';
import ActionsOptions from './actions-options';

export default function ActionsSelectRoot({ RecentsIcon }) {
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
    <>
      <ActionsSelect onClick={() => setShowOptions(!showOptions)}>
        Order by
        <div className='min-w-[50%] flex justify-between'>
          <span className='text-black flex-grow flex justify-center'>{selectedOption}</span>
          <RecentsIcon className='w-6 h-6' />
        </div>
      </ActionsSelect>
      <div
        className={`w-52 rounded-md h-fit bg-white border-[#EDEFF2] border-[2px] absolute z-[999] top-14 ${
          showOptions ? 'block' : 'hidden'
        }`}
      >
        <ActionsOptions
          setShowOptions={setShowOptions}
          options={options}
          selectedOption={selectedOption}
          setSelectedOption={setSelectedOption}
        />
      </div>
    </>
  );
}
