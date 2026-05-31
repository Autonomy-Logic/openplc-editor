import { ipcRenderer } from 'electron';
import { EventEmitter } from 'events';

class DownloadService extends EventEmitter {
  async downloadFile(url: string, destination: string): Promise<void> {
    this.emit('download-start', { url, destination });
    
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      await ipcRenderer.invoke('write-file', destination, buffer);
      this.emit('download-complete', { url, destination });
    } catch (error) {
      this.emit('download-error', { url, destination, error });
      throw error;
    }
  }

  async downloadMultiple(files: Array<{url: string, destination: string}>): Promise<void> {
    this.emit('download-start', { files });
    
    try {
      for (const file of files) {
        await this.downloadFile(file.url, file.destination);
      }
      this.emit('download-complete', { files });
    } catch (error) {
      this.emit('download-error', { files, error });
      throw error;
    }
  }
}

export default new DownloadService();