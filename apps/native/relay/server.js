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

/**
 * A few posts so a judge's first screen is not empty.
 *
 * These live only in the relay's backlog, so they arrive exactly like any other
 * message and every phone sees the same board. Set SEED=0 to start clean.
 */
function seedBacklog() {
  if (process.env.SEED === '0') return;

  const minutes = (n) => Date.now() - n * 60_000;
  const posts = [
    {
      id: 'seed-water',
      sender: 'seed-leoni',
      kind: 'offer',
      title: 'Spare six-pack of water',
      place: 'Block B lobby',
      category: 'supplies',
      at: minutes(240),
    },
    {
      id: 'seed-charge',
      sender: 'seed-amara',
      kind: 'request',
      title: 'Anyone have a power bank? Phone at 4%',
      place: 'Block C, 3rd floor',
      category: 'power',
      at: minutes(52),
    },
    {
      id: 'seed-lift',
      sender: 'seed-dev',
      kind: 'update',
      title: 'Lift in Block A is out — stairs only',
      place: 'Block A',
      category: 'access',
      at: minutes(18),
    },
    {
      id: 'seed-checkin',
      sender: 'seed-marcus',
      kind: 'request',
      title: 'Can someone check on flat 42? No answer since morning',
      place: 'Block B, flat 42',
      category: 'check-in',
      at: minutes(7),
    },
  ];

  for (const post of posts) {
    const envelope = {
      version: 1,
      messageId: post.id,
      roomId: 'commonthread',
      senderId: post.sender,
      createdAtMs: post.at,
      expiresAtMs: post.at + 12 * 60 * 60 * 1000,
      hopCount: 0,
      maxHops: 6,
      type: 'thread.created',
      payload: {
        title: post.title,
        kind: post.kind,
        category: post.category,
        place: post.place,
      },
      signature: '',
    };
    seen.add(envelope.messageId);
    backlog.push({ from: post.sender, envelope });
  }

  // One reply, so a thread shows activity rather than a bare list.
  const replyAt = minutes(35);
  const reply = {
    version: 1,
    messageId: 'seed-water-reply',
    roomId: 'commonthread',
    senderId: 'seed-priya',
    createdAtMs: replyAt,
    expiresAtMs: replyAt + 12 * 60 * 60 * 1000,
    hopCount: 0,
    maxHops: 6,
    type: 'thread.reply',
    payload: {
      threadId: 'seed-water',
      text: 'Coming down now, thank you.',
      isOffer: false,
    },
    signature: '',
  };
  seen.add(reply.messageId);
  backlog.push({ from: reply.senderId, envelope: reply });
}

/** ws -> { peerId, displayName } */
const clients = new Map();

seedBacklog();

const server = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

const SEED_NAMES = {
  'seed-leoni': 'Leoni',
  'seed-amara': 'Amara',
  'seed-dev': 'Dev',
  'seed-marcus': 'Marcus',
  'seed-priya': 'Priya',
};

function roster() {
  const live = [...clients.values()]
    .filter((client) => client.peerId !== null)
    .map((client) => ({ peerId: client.peerId, displayName: client.displayName }));

  // Seed authors are presented so their posts carry a name, not a device id.
  // They are not connected devices and never appear as reachable peers.
  return live;
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
