import { HTMLAttributes } from 'react';

type CardRootProps = HTMLAttributes<HTMLDivElement> & unknown;

export default function Root({ ...props }: CardRootProps) {
  return (
    <div
      className='relative flex flex-1 flex-col items-start justify-start bg-[#0350c9] w-full min-w-[224px] h-[180px] rounded-lg p-[6px] gap-[10px] text-left text-xs text-white'
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...props}
    />
  );
}
