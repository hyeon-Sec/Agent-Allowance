/** Tool runners may call several pay tools in parallel. Serialize their entire decision/receipt path. */
export class PaymentQueue {
  private tail: Promise<void> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
