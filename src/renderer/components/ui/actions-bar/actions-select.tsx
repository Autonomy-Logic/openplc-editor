/* eslint-disable react/jsx-props-no-spreading */
import React, { HTMLAttributes, ReactNode } from 'react';

type ActionsSelectProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};
export default function ActionsSelect({ children, ...props }: ActionsSelectProps) {
  return (
    <div
    {...props}
      className=' min-w-18 w-[180px] relative flex gap-2 rounded-lg  border-[#EDEFF2] border-[2px] items-center p-3 cursor-pointer '
    >
      {children}
    </div>
  );
}
