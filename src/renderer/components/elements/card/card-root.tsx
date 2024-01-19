import { HTMLAttributes } from 'react';

type CardRootProps = HTMLAttributes<HTMLDivElement> & unknown;

export default function Root({ ...props }: CardRootProps) {
  return (
    <div
      className='mr-8 xl:mr-[18px] xxl:mr-8 relative flex flex-1 flex-col items-start justify-start bg-brand-medium w-full min-w-[224px] h-[180px] rounded-lg px-[6px] pt-[6px] pb-[10px] gap-[10px] text-left text-xs text-white font-caption hover:bg-brand-medium-dark cursor-pointer'
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...props}
    />
  );
}
