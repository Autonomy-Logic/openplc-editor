/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable no-console */
import { HTMLAttributes, ReactNode } from 'react';

type MenuRootProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export default function Root({ children, ...props }: MenuRootProps) {
  return (
    <div
      className='flex flex-col h-52 mr-6 bg-white justify-between text-xl text-[#030303]'
      {...props}
    >
      {children}
    </div>
  );
}
