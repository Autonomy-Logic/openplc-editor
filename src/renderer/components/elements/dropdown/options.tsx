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
      <div className='w-full h-full flex flex-col'>
        {options.map((option) => (
          <button
            type='button'
            className={cn(
              selectedOption === option.label && 'bg-neutral-100',
              'cursor-pointer hover:bg-neutral-50'
            )}
            key={option.label}
            onClick={() => handleOptionClick(option)}
          >
            <p className='flex-1 text-neutral-1000 text-left py-[10px] pl-4'>{option.label}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
