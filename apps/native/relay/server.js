/**
 * Dumb fan-out relay for the Expo Go demo.
 *
 * It moves opaque envelopes between phones on the same Wi-Fi and never looks
 * inside them — the payload is still signed and validated by the same code
 * that runs over Bluetooth, so the domain cannot tell the two apart.
 *
 * This is NOT Bluetooth and must never be labelled as such in the UI.
 *
 *   node relay/server.js
 */

const { WebSocketServer } = require('ws');
const os = require('os');

const PORT = Number(process.env.RELAY_PORT ?? 17833);

/** Most recent envelopes, so a phone that joins late still sees the room. */
const BACKLOG_LIMIT = 300;
const backlog = [];
const seen = new Set();

/** ws -> { peerId, displayName } */
const clients = new Map();

const server = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

function roster() {
  return [...clients.values()]
    .filter((client) => client.peerId !== null)
    .map((client) => ({ peerId: client.peerId, displayName: client.displayName }));
}

function broadcastRoster() {
  const peers = roster();
  for (const [socket, client] of clients) {
    if (socket.readyState !== socket.OPEN) continue;
    send(socket, {
      t: 'peers',
      // Never include the recipient in its own peer list.
      peers: peers.filter((peer) => peer.peerId !== client.peerId),
    });
  }
}

function send(socket, message) {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // A dead socket is cleaned up by the close handler.
  }
}

server.on('connection', (socket) => {
  clients.set(socket, { peerId: null, displayName: null });

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    const client = clients.get(socket);
    if (client === undefined) return;

    if (message.t === 'hello') {
      client.peerId = String(message.peerId ?? '');
      client.displayName =
        typeof message.displayName === 'string' ? message.displayName : null;

      // Replay first so the newcomer has history before any live traffic.
      for (const entry of backlog) {
        send(socket, { t: 'env', from: entry.from, envelope: entry.envelope });
      }
      broadcastRoster();
      return;
    }

    if (message.t === 'env' && message.envelope !== undefined) {
      const envelope = message.envelope;
      const id = envelope.messageId;

      if (typeof id === 'string') {
        if (seen.has(id)) return;
        seen.add(id);
      }

      backlog.push({ from: client.peerId, envelope });
      if (backlog.length > BACKLOG_LIMIT) backlog.shift();

      for (const [other] of clients) {
        if (other === socket || other.readyState !== other.OPEN) continue;
        send(other, { t: 'env', from: client.peerId, envelope });
      }
      return;
    }

    if (message.t === 'ack' && typeof message.to === 'string') {
      for (const [other, info] of clients) {
        if (info.peerId !== message.to || other.readyState !== other.OPEN) continue;
        send(other, { t: 'ack', messageId: message.messageId, peerId: client.peerId });
      }
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
    broadcastRoster();
  });

  socket.on('error', () => {
    clients.delete(socket);
  });
});

const addresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
  .map((entry) => entry.address);

console.log(`Common Thread relay listening on port ${PORT}`);
for (const address of addresses) {
  console.log(`  ws://${address}:${PORT}`);
}
console.log('Phones must be on this same network. Not Bluetooth.');
