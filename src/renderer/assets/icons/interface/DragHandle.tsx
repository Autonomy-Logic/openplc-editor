export const DragHandleIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      fill='#000000'
      width='800px'
      height='800px'
      viewBox='0 0 36 36'
      version='1.1'
      preserveAspectRatio='xMidYMid meet'
      xmlns='http://www.w3.org/2000/svg'
      className={props.className}
    >
      <title>drag-handle-line</title>
      <circle cx='15' cy='12' r='1.5' className='clr-i-outline clr-i-outline-path-1'></circle>
      <circle cx='15' cy='24' r='1.5' className='clr-i-outline clr-i-outline-path-2'></circle>
      <circle cx='21' cy='12' r='1.5' className='clr-i-outline clr-i-outline-path-3'></circle>
      <circle cx='21' cy='24' r='1.5' className='clr-i-outline clr-i-outline-path-4'></circle>
      <circle cx='21' cy='18' r='1.5' className='clr-i-outline clr-i-outline-path-5'></circle>
      <circle cx='15' cy='18' r='1.5' className='clr-i-outline clr-i-outline-path-6'></circle>
      <rect x='0' y='0' width='36' height='36' fill-opacity='0' />
    </svg>
  )
}
