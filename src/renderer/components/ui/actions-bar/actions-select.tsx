/* eslint-disable react/jsx-props-no-spreading */
import React, { HTMLAttributes, ReactNode } from 'react';

type ActionsSelectProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};
export default function ActionsSelect({ children, ...props }: ActionsSelectProps) {
  return (
    <div
      {...props}
      className='min-w-18 w-52  whitespace-nowrap text-base relative flex items-center rounded-lg justify-center border-[#EDEFF2] border-[2px] p-3 cursor-pointer '
    >
      {children}
    </div>
  );
}
