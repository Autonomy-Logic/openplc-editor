import { HTMLAttributes } from 'react';

type NavContainerProps = HTMLAttributes<HTMLDivElement> & unknown;

export default function Container({ ...props }: NavContainerProps) {
  return (
    <div className='flex items-center absolute top-1/2 left-[1.6rem] -translate-y-1/2' {...props} />
  );
}
