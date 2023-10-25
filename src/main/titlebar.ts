import { TitlebarColor, Titlebar } from 'custom-electron-titlebar';
import colors from 'tailwindcss/colors';

window.addEventListener('DOMContentLoaded', () => {
  // eslint-disable-next-line no-new
  new Titlebar({
    containerOverflow: 'hidden',
    backgroundColor: TitlebarColor?.fromHex(colors.gray['900']),
  });
});

const [titlebar] = document.getElementsByClassName('cet-titlebar');
const [container] = document.getElementsByClassName('cet-container');

if (titlebar && container) {
  // eslint-disable-next-line no-restricted-globals, eqeqeq
  if (window.innerHeight == screen.height) {
    container.classList.replace('!top-16', '!top-0');
  } else {
    container.classList.add('!top-16');
    container.classList.replace('!top-0', '!top-16');
  }
}
