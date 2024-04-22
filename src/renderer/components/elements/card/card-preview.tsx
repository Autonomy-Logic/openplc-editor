import { ComponentProps } from 'react'

type ICardPreviewProps = ComponentProps<'img'> & {
  source: string
}
const Preview = ({ source, ...props }: ICardPreviewProps) => (
  // biome-ignore lint/a11y/useAltText: <Does not make sense in this context, can be reviewed>
  <img
    src={source}
    className='self-stretch flex-1 relative rounded-md max-w-full overflow-hidden max-h-full object-cover cursor-pointer'
    {...props}
  />
)

export default Preview
