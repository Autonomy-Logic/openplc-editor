/* eslint-disable react/jsx-props-no-spreading */
import React, { HTMLAttributes, ReactNode } from 'react';

type ActionsSelectProps = HTMLAttributes<HTMLDivElement> & {
  selectedOption: string;
  icon: ReactNode;
  setShowOptions: React.Dispatch<React.SetStateAction<boolean>>;
  showOptions: boolean;
};
export default function Select({
  selectedOption,
  icon,
  setShowOptions,
  showOptions,
  placeholder,
}: ActionsSelectProps) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      onClick={() => setShowOptions(!showOptions)}
      style={{ userSelect: 'none' }}
      className='min-w-18 w-52  whitespace-nowrap text-base relative flex items-center rounded-lg justify-center border-[#EDEFF2] border-[2px] h-12 p-3 cursor-pointer '
    >
      {placeholder}
      <div className='min-w-[50%] flex justify-between'>
        <span className='text-black flex-grow flex justify-center'>{selectedOption}</span>
        <span>{icon}</span>
      </div>
    </div>
  );
}
