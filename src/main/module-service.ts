import type { ModuleOperationResult, ModuleSummary } from '../shared/contracts';

const plannedModules: ModuleSummary[] = [];

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
