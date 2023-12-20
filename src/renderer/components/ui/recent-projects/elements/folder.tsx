export default function Folder() {
  return (
    <svg
      className='group'
      width='224'
      height='160'
      viewBox='0 0 224 160'
      xmlns='http://www.w3.org/2000/svg'
    >
      <text className='fill-white group-hover:cursor-pointer group folder-icon'>
        <tspan x='12' y='134' className='text-xs'>
          Project Name
        </tspan>
        <tspan x='12' y='148' className='text-[10px] opacity-40'>
          Last Modified
        </tspan>
      </text>
      <path
        id='folder-shape'
        className='fill-blue-700 hover:fill-blue-600 group-hover:cursor-pointer group-has-[:hover]:fill-blue-600'
        d='M224 153.143V33.5238C224 29.7367 220.991 26.6667 217.28 26.6667H136.217C135.027 26.6667 133.858 26.3443 132.831 25.7326L91.1693 0.934087C90.1415 0.322343 88.9731 0 87.7833 0H6.72C3.00865 0 0 3.07005 0 6.85715V153.143C0 156.93 3.00864 160 6.71999 160H217.28C220.991 160 224 156.93 224 153.143Z'
      />
    </svg>
  );
}
