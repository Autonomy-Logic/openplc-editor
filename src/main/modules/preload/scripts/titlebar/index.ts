import { Titlebar, TitlebarColor } from 'custom-electron-titlebar';
import { logoIcon, darkThemeIcon, lightThemeIcon } from './assets/base64Icons';

window.addEventListener('DOMContentLoaded', () => {
  const options = {
    containerOverflow: 'hidden',
    backgroundColor: TitlebarColor?.fromHex('#121316'),
    icon: logoIcon,
  };
  new Titlebar(options);

  const iconContainer = document.querySelector('.cet-title');
  if (iconContainer) {
    iconContainer.classList.replace('cet-title', 'cet-icon-container');

    const toggleTheme = document.createElement('button');
    toggleTheme.classList.add('cet-toggle-theme');
    iconContainer.appendChild(toggleTheme);

    const toggleThemeIcon = document.createElement('img');
    toggleThemeIcon.classList.add('toggle-theme-icon');
    toggleThemeIcon.src = darkThemeIcon;
    toggleTheme.appendChild(toggleThemeIcon);

    let isDarkTheme = true;

    function toggleThemeHandler() {
      toggleThemeIcon.src = isDarkTheme ? lightThemeIcon : darkThemeIcon;
      isDarkTheme = !isDarkTheme;
      
    }

    toggleTheme.addEventListener('click', toggleThemeHandler);
  }
});
