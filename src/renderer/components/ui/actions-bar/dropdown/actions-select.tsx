/* eslint-disable react/jsx-props-no-spreading */
import { cn } from '@/utils';
import React, { HTMLAttributes, ReactNode } from 'react';

type ActionsSelectProps = HTMLAttributes<HTMLDivElement> & {
  selectedOption: string;
  icon: ReactNode;
  setShowOptions: React.Dispatch<React.SetStateAction<boolean>>;
  showOptions: boolean;
  placeholder: string;
  className?: string;
};
export default function Select({
  selectedOption,
  icon,
  setShowOptions,
  showOptions,
  placeholder,
  ...props
}: ActionsSelectProps) {
  const { className } = props;
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className={cn(className)}
      onClick={() => setShowOptions(!showOptions)}
      style={{ userSelect: 'none' }}
    >
      {placeholder}
      <div className=' flex justify-between w-28'>
        <span className='text-black '>{selectedOption}</span>
        <span className={` ${showOptions ? '-rotate-180' : 'rotate-0'} transition-all `}>
          {icon}
        </span>
      </div>
    </div>
  );
}
