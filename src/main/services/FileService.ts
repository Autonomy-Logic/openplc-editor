import { dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

class FileService {
  async showXmlSaveDialog(defaultPath?: string): Promise<string | null> {
    const result = await dialog.showSaveDialog({
      title: 'Save XML File',
      defaultPath: defaultPath || 'export.xml',
      filters: [
        { name: 'XML Files', extensions: ['xml'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled) {
      return null;
    }

    return result.filePath || null;
  }

  async saveXmlFile(filePath: string, content: string): Promise<boolean> {
    try {
      // Ensure the directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write the file
      fs.writeFileSync(filePath, content, 'utf8');
      return true;
    } catch (error) {
      console.error('Failed to save XML file:', error);
      return false;
    }
  }

  async showXmlExportSaveDialog(content: string, defaultFileName?: string): Promise<boolean> {
    const filePath = await this.showXmlSaveDialog(defaultFileName);
    
    if (!filePath) {
      return false;
    }

    return await this.saveXmlFile(filePath, content);
  }
}

export default new FileService();