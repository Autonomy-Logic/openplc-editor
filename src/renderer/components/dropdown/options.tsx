/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Dispatch, HTMLAttributes, SetStateAction } from 'react';

import { cn } from '@/utils';

type DropdownOptionProps = {
  label: string;
  onClick: () => void;
};

type DropdownOptionsProps = HTMLAttributes<HTMLDivElement> & {
  setShowOptions: Dispatch<SetStateAction<boolean>>;
  options: DropdownOptionProps[];
  setSelectedOption: Dispatch<SetStateAction<string>>;
  selectedOption?: string;
  showOptions?: boolean;
};
export default function Options({
  setShowOptions,
  options,
  setSelectedOption,
  className,
  selectedOption,
  ...props
}: DropdownOptionsProps) {
  const handleOptionClick = (option: DropdownOptionsProps['options'][0]) => {
    setSelectedOption(option.label);
    option.onClick();
    setShowOptions(false);
  };

  return (
    <div className={cn(className)} {...props}>
      {options.map((option) => (
        <button
          type='button'
          className=' cursor-pointer  hover:bg-[#F5F7F8]  text-[#030303]'
          key={option.label}
          onClick={() => handleOptionClick(option)}
        >
          <span
            className={` h-10 justify-center flex flex-col px-3 ${
              selectedOption === option.label ? 'bg-[#EDEFF2]' : ''
            }`}
          >
            {option.label}
          </span>
        </button>
      ))}
    </div>
  );
}
