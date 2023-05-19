import logoSvg from './assets/logo';

const domReady = (condition: DocumentReadyState[] = ['complete', 'interactive']) => {
  return new Promise((resolve) => {
    if (condition.includes(document.readyState)) {
      resolve(true);
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true);
        }
      });
    }
  });
};

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement | Document) {
    if (!Array.from(parent.children).find((e) => e === child)) {
      return parent.appendChild(child);
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find((e) => e === child)) {
      return parent.removeChild(child);
    }
  },
};

const useLoading = () => {
  const preloadClassName = 'preload';
  const logoClassName = 'logo';
  const styleContent = `
    .${preloadClassName} {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      z-index: 99999;
      background: black;
      color: white;
    }
    .${logoClassName} {
      display: flex;
      align-items: center;
    }
  `;

  const style = document.createElement('style');
  const container = document.createElement('div');
  const content = `<div class=${logoClassName}>${logoSvg}</div>`;

  style.id = 'app-loading-style';
  style.innerHTML = styleContent;

  container.className = preloadClassName;
  container.innerHTML = content;
  return {
    appendLoading() {
      safeDOM.append(document.head, style);
      safeDOM.append(document.body, container);
    },
    removeLoading() {
      safeDOM.remove(document.head, style);
      safeDOM.remove(document.body, container);
    },
  };
};

// eslint-disable-next-line react-hooks/rules-of-hooks
const { appendLoading, removeLoading } = useLoading();
domReady().then(appendLoading);

window.onmessage = (event) => {
  event.data.payload === 'removeLoading' && removeLoading();
};

setTimeout(removeLoading, 4999);

export {};
