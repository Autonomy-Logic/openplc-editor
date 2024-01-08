/* eslint-disable react/jsx-props-no-spreading */
import { ButtonHTMLAttributes, Dispatch, ReactNode, SetStateAction } from 'react';

import { cn } from '@/utils';

type DropdownSelectProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selectedOption: string;
  icon: ReactNode;
  setShowOptions: Dispatch<SetStateAction<boolean>>;
  showOptions: boolean;
  placeholder: string;
};
export default function Select({
  selectedOption,
  icon,
  setShowOptions,
  showOptions,
  placeholder,
  className,
  ...props
}: DropdownSelectProps) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <button
      type='button'
      className={cn('select-none', className)}
      onClick={() => setShowOptions(!showOptions)}
      {...props}
    >
      {placeholder}
      <p className='flex justify-between w-28'>
        <span className='text-black '>{selectedOption}</span>
        <span className={` ${showOptions ? '-rotate-180' : 'rotate-0'} transition-all `}>
          {icon}
        </span>
      </p>
    </button>
  );
}
