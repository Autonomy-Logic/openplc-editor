import { ComponentProps } from 'react'

type ICardPreviewProps = ComponentProps<'img'> & {
  source: string
}
const Preview = ({ source, ...props }: ICardPreviewProps) => (
  // biome-ignore lint/a11y/useAltText: <Does not make sense in this context, can be reviewed>
  <img
    src={source}
    className='relative max-h-full max-w-full flex-1 cursor-pointer self-stretch overflow-hidden rounded-md object-cover'
    {...props}
  />
)

export default Preview
