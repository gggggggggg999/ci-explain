// Preloaded with `node --import` to prove a command makes no network calls:
// any attempt to use fetch or open a socket throws.
import net from 'node:net';

const fail = () => {
  throw new Error('NETWORK ACCESS ATTEMPTED');
};
globalThis.fetch = fail;
net.Socket.prototype.connect = fail;
