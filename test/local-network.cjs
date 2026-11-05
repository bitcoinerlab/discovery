// Preloaded only by test:local. Public smoke tests do not use this guard.
const net = require('node:net');
const connect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (!(options && typeof options === 'object' && options.path)) {
    const host =
      options && typeof options === 'object'
        ? options.host || 'localhost'
        : typeof args[1] === 'string'
          ? args[1]
          : 'localhost';
    if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
      throw new Error(
        `Local tests cannot connect to ${host}. Use npm run test:public for public servers.`
      );
    }
  }
  return connect.apply(this, args);
};
