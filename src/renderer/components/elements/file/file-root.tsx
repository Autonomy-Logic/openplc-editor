/* eslint-disable @typescript-eslint/no-explicit-any */
import { HTMLAttributes } from 'react';

type FolderRootProps = HTMLAttributes<HTMLDivElement> & unknown;
// {
//   size?: 'sm' | 'md' | 'lg';
// };

export default function Root({ ...props }: FolderRootProps) {
  return (
    // eslint-disable-next-line react/jsx-props-no-spreading
    <div
      title='file-root'
      id='folder-root'
      className='flex relative w-[224px] h-[160px]'
      {...props}
    />
  );
}
