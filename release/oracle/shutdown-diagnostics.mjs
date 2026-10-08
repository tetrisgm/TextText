import { subscribe, unsubscribe } from 'node:diagnostics_channel';

// Fixed categories only: never retain or log URLs, IDs, headers or bodies.
function category(request) {
  const method = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method) ? request.method : 'OTHER';
  const pathname = (request.url ?? '').split('?')[0];
  const route = /^\/api\/vault\/[^/]+\/items$/.test(pathname) ? 'manifest'
    : /^\/api\/collab\//.test(pathname) ? 'collaboration'
    : pathname === '/api/ai' ? 'assistant'
    : pathname === '/api/mcp' ? 'mcp'
    : /capture/.test(pathname) && pathname.startsWith('/api/') ? 'capture'
    : pathname.startsWith('/api/') ? 'other-api' : 'page-or-asset';
  return `${method}:${route}`;
}

export function installHttpShutdownLifecycle({ signals = process, log = console.info, delays = [10_000, 20_000] } = {}) {
  const requests = new Map(), sockets = new Set(), unstarted = new Set(), timers = new Set();
  const cleanups = new Map();
  let draining = false;
  const trackRequest = ({ request, response }) => {
    unstarted.delete(request.socket);
    requests.set(response, { category: category(request), started: Date.now() });
    const finished = () => {
      requests.delete(response); cleanups.delete(response);
      response.removeListener('finish', finished); response.removeListener('close', finished);
    };
    cleanups.set(response, finished);
    response.once('finish', finished); response.once('close', finished);
  };
  const trackSocket = ({ socket }) => {
    sockets.add(socket); unstarted.add(socket);
    const closed = () => { sockets.delete(socket); unstarted.delete(socket); cleanups.delete(socket); };
    cleanups.set(socket, closed); socket.once('close', closed);
    if (draining) socket.destroy();
  };
  const snapshot = () => {
    const active = {};
    for (const request of requests.values()) {
      const group = active[request.category] ??= { count: 0, oldestMs: 0 };
      group.count++; group.oldestMs = Math.max(group.oldestMs, Date.now() - request.started);
    }
    return { sockets: sockets.size, unstartedSockets: unstarted.size, active };
  };
  const report = () => log(`TextText shutdown: ${JSON.stringify(snapshot())}`);
  const drain = () => {
    if (draining) return;
    draining = true; report();
    // server.close() waits for sockets that have not supplied HTTP headers.
    // They have never reached a handler, so no operation or write can exist.
    // Next remains responsible for every socket that has started a request.
    for (const socket of unstarted) socket.destroy();
    for (const delay of delays) {
      const timer = setTimeout(() => { timers.delete(timer); report(); }, delay);
      timer.unref(); timers.add(timer);
    }
  };
  subscribe('http.server.request.start', trackRequest);
  subscribe('net.server.socket', trackSocket);
  signals.once('SIGTERM', drain); signals.once('SIGINT', drain);
  return { snapshot, dispose() {
    unsubscribe('http.server.request.start', trackRequest);
    unsubscribe('net.server.socket', trackSocket);
    signals.removeListener('SIGTERM', drain); signals.removeListener('SIGINT', drain);
    for (const timer of timers) clearTimeout(timer);
    for (const [target, cleanup] of cleanups) {
      target.removeListener('finish', cleanup); target.removeListener('close', cleanup);
    }
    timers.clear(); cleanups.clear(); requests.clear(); sockets.clear(); unstarted.clear();
  } };
}
