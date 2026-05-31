import { app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Project } from '../../shared/types';

export class ProjectService {
  private static instance: ProjectService;
  private project: Project | null = null;

  private constructor() {}

  public static getInstance(): ProjectService {
    if (!ProjectService.instance) {
      ProjectService.instance = new ProjectService();
    }
    return ProjectService.instance;
  }

  public setProject(project: Project): void {
    this.project = project;
  }

  public getProject(): Project | null {
    return this.project;
  }

  public exportPouAsXml(pouId: string): void {
    if (!this.project) {
      throw new Error('No project loaded');
    }

    const pou = this.project.pous.find(p => p.id === pouId);
    if (!pou) {
      throw new Error(`POU with id ${pouId} not found`);
    }

    const xmlContent = this.generatePouXml(pou);
    this.saveXmlToFile(xmlContent, `${pou.name}.xml`);
  }

  public exportFunctionAsXml(functionId: string): void {
    if (!this.project) {
      throw new Error('No project loaded');
    }

    const func = this.project.functions.find(f => f.id === functionId);
    if (!func) {
      throw new Error(`Function with id ${functionId} not found`);
    }

    const xmlContent = this.generateFunctionXml(func);
    this.saveXmlToFile(xmlContent, `${func.name}.xml`);
  }

  public exportFunctionBlockAsXml(fbId: string): void {
    if (!this.project) {
      throw new Error('No project loaded');
    }

    const fb = this.project.functionBlocks.find(f => f.id === fbId);
    if (!fb) {
      throw new Error(`Function Block with id ${fbId} not found`);
    }

    const xmlContent = this.generateFunctionBlockXml(fb);
    this.saveXmlToFile(xmlContent, `${fb.name}.xml`);
  }

  public exportUdtAsXml(udtId: string): void {
    if (!this.project) {
      throw new Error('No project loaded');
    }

    const udt = this.project.udts.find(u => u.id === udtId);
    if (!udt) {
      throw new Error(`UDT with id ${udtId} not found`);
    }

    const xmlContent = this.generateUdtXml(udt);
    this.saveXmlToFile(xmlContent, `${udt.name}.xml`);
  }

  private generatePouXml(pou: any): string {
    // Generate XML structure for POU
    return `<?xml version="1.0" encoding="UTF-8"?>
<pou name="${pou.name}" id="${pou.id}">
  <!-- POU content -->
</pou>`;
  }

  private generateFunctionXml(func: any): string {
    // Generate XML structure for Function
    return `<?xml version="1.0" encoding="UTF-8"?>
<function name="${func.name}" id="${func.id}">
  <!-- Function content -->
</function>`;
  }

  private generateFunctionBlockXml(fb: any): string {
    // Generate XML structure for Function Block
    return `<?xml version="1.0" encoding="UTF-8"?>
<functionBlock name="${fb.name}" id="${fb.id}">
  <!-- Function Block content -->
</functionBlock>`;
  }

  private generateUdtXml(udt: any): string {
    // Generate XML structure for UDT
    return `<?xml version="1.0" encoding="UTF-8"?>
<udt name="${udt.name}" id="${udt.id}">
  <!-- UDT content -->
</udt>`;
  }

  private saveXmlToFile(content: string, filename: string): void {
    const options = {
      defaultPath: path.join(app.getPath('documents'), filename),
      filters: [
        { name: 'XML Files', extensions: ['xml'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    };

    dialog.showSaveDialog(options).then(result => {
      if (!result.canceled && result.filePath) {
        fs.writeFile(result.filePath, content, 'utf8', (err) => {
          if (err) {
            console.error('Failed to save XML file:', err);
          }
        });
      }
    });
  }
}
