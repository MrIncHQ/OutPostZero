import type { ModuleOperationResult, ModuleSummary } from '../shared/contracts';

const plannedModules: ModuleSummary[] = [
  { id: 'education', name: 'Education Center', description: 'Drive-contained courses, lessons, and learning progress.', status: 'available-later', optional: true },
  { id: 'ocr', name: 'OCR Pack', description: 'Extract searchable text from image-only documents.', status: 'available-later', optional: true },
  { id: 'local-ai', name: 'Local AI Assistant', description: 'Optional portable AI runtime and user-selected model.', status: 'available-later', optional: true },
];

export class ModuleService {
  modules(): ModuleSummary[] {
    return plannedModules.map((module) => ({ ...module }));
  }

  private result(message: string): ModuleOperationResult {
    return { ok: false, message, modules: this.modules() };
  }

  install(_moduleId: string): Promise<ModuleOperationResult> {
    return Promise.resolve(this.result('That module is not available for installation yet.'));
  }

  repair(_moduleId: string): Promise<ModuleOperationResult> {
    return Promise.resolve(this.result('That module is not available for repair.'));
  }

  start(_moduleId: string): Promise<ModuleOperationResult> {
    return Promise.resolve(this.result('That module cannot be started yet.'));
  }

  stop(_moduleId: string): Promise<ModuleOperationResult> {
    return Promise.resolve({ ok: true, message: 'Module process is already stopped.', modules: this.modules() });
  }

  uninstall(_moduleId: string): Promise<ModuleOperationResult> {
    return Promise.resolve(this.result('That module is not installed.'));
  }

  stopAll(): Promise<void> {
    return Promise.resolve();
  }

  hasRunningModules(): boolean {
    return false;
  }
}
