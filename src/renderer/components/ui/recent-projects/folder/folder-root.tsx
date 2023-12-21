/* eslint-disable @typescript-eslint/no-explicit-any */
import { HTMLAttributes } from 'react';

type FolderRootProps = HTMLAttributes<HTMLDivElement> & Record<string, never>;
// {
//   size?: 'sm' | 'md' | 'lg';
// };

export default function Root({ ...props }: FolderRootProps) {
  // eslint-disable-next-line react/jsx-props-no-spreading
  return <div id='folder-root' className='flex relative w-56 h-40' {...props} />;
}
