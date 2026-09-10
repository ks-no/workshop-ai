import { Server } from 'node:net';
// Upstream native entry points omit the host. Keep this local demo on loopback,
// matching the upstream Docker Compose port binding, without changing its source.
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) args.splice(1, 0, '127.0.0.1');
  return listen.apply(this, args);
};
