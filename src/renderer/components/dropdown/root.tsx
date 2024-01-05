import { HTMLAttributes, ReactNode } from 'react';

type DropdownRootProps = HTMLAttributes<HTMLDivElement>;
export default function Root({ ...props }: DropdownRootProps): ReactNode {
  return <div className='relative' {...props} />;
}
