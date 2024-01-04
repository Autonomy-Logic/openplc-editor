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
  selectedOption: string;
  setSelectedOption: React.Dispatch<React.SetStateAction<string>>;
  showOptions?: boolean;
  className?: string;
};
export default function Options({
  setShowOptions,
  options,
  selectedOption,
  setSelectedOption,
  ...props
}: ActionsSelectOptionsProps) {
  const { className } = props;
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
          className='cursor-pointer hover:bg-gray-100 p-3'
          key={option.label}
          onClick={() => handleOptionClick(option)}
          style={{
            fontWeight: selectedOption === option.label ? 'bold' : 'normal',
          }}
        >
          {option.label}
        </div>
      ))}
    </div>
  );
}
