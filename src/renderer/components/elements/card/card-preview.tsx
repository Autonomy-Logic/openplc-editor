import { ImgHTMLAttributes } from 'react';

type CardPreviewProps = ImgHTMLAttributes<HTMLImageElement> & {
  source: string;
};
export default function Preview({ source, ...props }: CardPreviewProps) {
  return (
    <img
      alt='card-preview'
      src={source}
      className='self-stretch flex-1 relative rounded-md max-w-full overflow-hidden max-h-full object-cover'
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...props}
    />
  );
}
