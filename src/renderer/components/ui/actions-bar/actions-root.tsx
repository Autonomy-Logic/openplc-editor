/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable no-console */
import { HTMLAttributes, ReactNode } from 'react';

type ActionsRootProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export default function ActionsRoot({ children, ...props }: ActionsRootProps) {
  return (
    <div
      className='w-full items-center flex gap-4 px-3 relative'
      {...props}
    >
      {children}
    </div>
  );
}
