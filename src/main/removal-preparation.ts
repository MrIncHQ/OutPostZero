// Serialize repeated clicks and resume at the failed step without repeating
// completed operations (in particular, backing up an already closed database).
export class RemovalPreparation {
  private nextStep = 0;
  private pending: Promise<void> | undefined;

  constructor(private readonly steps: Array<() => void | Promise<unknown>>) {}

  run(): Promise<void> {
    if (!this.pending) {
      this.pending = Promise.resolve().then(async () => {
        while (this.nextStep < this.steps.length) {
          await this.steps[this.nextStep]();
          this.nextStep++;
        }
      }).catch((error) => {
        this.pending = undefined;
        throw error;
      });
    }
    return this.pending;
  }
}
