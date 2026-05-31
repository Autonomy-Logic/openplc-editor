import { ipcRenderer } from 'electron';
import { EventEmitter } from 'events';

class ConsoleManager extends EventEmitter {
  private isVisible: boolean = false;
  private consoleElement: HTMLElement | null = null;

  constructor() {
    super();
    this.setupDownloadListener();
  }

  private setupDownloadListener(): void {
    ipcRenderer.on('download-started', () => {
      this.showConsole();
    });
  }

  public showConsole(): void {
    this.isVisible = true;
    if (this.consoleElement) {
      this.consoleElement.style.display = 'block';
    }
    this.emit('console-shown');
  }

  public hideConsole(): void {
    this.isVisible = false;
    if (this.consoleElement) {
      this.consoleElement.style.display = 'none';
    }
    this.emit('console-hidden');
  }

  public toggleConsole(): void {
    if (this.isVisible) {
      this.hideConsole();
    } else {
      this.showConsole();
    }
  }

  public setConsoleElement(element: HTMLElement): void {
    this.consoleElement = element;
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }
}

export default ConsoleManager;