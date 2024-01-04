/* eslint-disable simple-import-sort/imports */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { cn } from '@/utils';
import React from 'react';

type ActionsSelectOptionsProps = {
  setShowOptions: React.Dispatch<React.SetStateAction<boolean>>;
  options: {
    label: string;
    onClick: () => void;
  }[];
  setSelectedOption: React.Dispatch<React.SetStateAction<string>>;
  selectedOption?: string;
  showOptions?: boolean;
  className?: string;
};
export default function Options({
  setShowOptions,
  options,
  setSelectedOption,
  ...props
}: ActionsSelectOptionsProps) {
  const { className, selectedOption } = props;
  const handleOptionClick = (option: ActionsSelectOptionsProps['options'][0]) => {
    setSelectedOption(option.label);
    option.onClick();
    setShowOptions(false);
  };

  return (
    <div className={cn(className)}>
      {options.map((option) => (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          className=' cursor-pointer  hover:bg-[#F5F7F8]  text-[#030303]'
          key={option.label}
          onClick={() => handleOptionClick(option)}
        >
          <span className={` h-10 justify-center flex flex-col px-3 ${selectedOption === option.label ? 'bg-[#EDEFF2]' : ''}`}>{option.label}</span>
        </div>
      ))}
    </div>
  );
}
