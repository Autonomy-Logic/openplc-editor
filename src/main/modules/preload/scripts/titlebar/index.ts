import { Titlebar, TitlebarColor } from 'custom-electron-titlebar';
// import colors from 'tailwindcss/colors';
import logoIcon from './assets/logoIcon'
// Wip: Should export the titlebar instance
window.addEventListener('DOMContentLoaded', () => {
  const options = {
    containerOverflow: 'hidden',
    backgroundColor: TitlebarColor?.fromHex('#121316'),
    icon: logoIcon,
  };
  // eslint-disable-next-line no-new
  new Titlebar(options);
});

//

// const [menubar] = document.getElementsByClassName('cet-menubar');

// if (menubar) {
//   const menuButtonDiv = document.createElement('div');
//   menuButtonDiv.className = 'cet-menubar-logo';
//   const logo = document.createElement('img');
//   logo.src = OpenPLCIcon;
//   logo.alt = 'OpenPLC logo';

//   menuButtonDiv.appendChild(logo);

//   menubar.appendChild(menuButtonDiv);
// }
