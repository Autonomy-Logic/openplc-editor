import { Project } from '../types/Project';
import { LadderProgram } from '../types/LadderProgram';

export class ProjectService {
  static duplicateLadderProgram(project: Project, programId: string): Project {
    const programToDuplicate = project.ladderPrograms.find(p => p.id === programId);
    
    if (!programToDuplicate) {
      throw new Error(`Ladder program with id ${programId} not found`);
    }

    // Create a deep copy of the program
    const duplicatedProgram: LadderProgram = JSON.parse(JSON.stringify(programToDuplicate));
    
    // Generate new ID for the duplicated program
    duplicatedProgram.id = this.generateUniqueId();
    
    // Update the name to indicate it's a copy
    duplicatedProgram.name = `${programToDuplicate.name} (Copy)`;

    // Add the duplicated program to the project
    return {
      ...project,
      ladderPrograms: [...project.ladderPrograms, duplicatedProgram]
    };
  }

  private static generateUniqueId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}