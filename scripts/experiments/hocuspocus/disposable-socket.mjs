import { HocuspocusProviderWebsocket } from '@hocuspocus/provider';

// Evaluation adapter: 4.7.0's onClose schedules connect() without retaining the
// timer. It can fire after destroy(), restarting a disposed socket's retry loop.
// Guard the public lifecycle boundary without patching library internals.
export class DisposableSocket extends HocuspocusProviderWebsocket {
  connect() {
    if (this.disposed) return Promise.resolve();
    return super.connect();
  }

  destroy() {
    this.disposed = true;
    super.destroy();
  }
}
