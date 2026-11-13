// Applies and reloads run one at a time (a theme pick, the config watcher and a page load can arrive together).
// The chain lives in the shared state, so it also orders work queued by an earlier apply.
import type { Log, SharedState } from './types';

export class SerialQueue {
  constructor(private readonly state: SharedState, private readonly log: Log) {
    state.queue ??= Promise.resolve();
  }

  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const step = () => fn();
    const run = this.state.queue.then(step, step);
    this.state.queue = run.catch((e) => this.log(e));
    return run;
  }
}
