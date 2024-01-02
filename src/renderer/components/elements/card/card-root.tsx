import { HTMLAttributes } from 'react';

type CardRootProps = HTMLAttributes<HTMLDivElement> & unknown;

export default function Root({ ...props }: CardRootProps) {
  return (
    <div
      className='relative flex flex-1 flex-col items-start justify-start bg-[#0350c9] w-full min-w-[224px] h-[180px] rounded-lg px-[6px] pt-[6px] pb-[10px] gap-[10px] text-left text-xs text-white'
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...props}
    />
  );
}
