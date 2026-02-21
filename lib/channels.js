/**
 * Real-time channels for SSE pub/sub
 *
 * Functions use req.subscribe(channel) and req.publish(channel, data)
 * to enable real-time communication between clients.
 */

const channels = new Map(); // channel -> Set<{ controller, heartbeat }>
const HEARTBEAT_MS = 30000;
const MAX_SUBSCRIBERS_PER_CHANNEL = Number(process.env.BUNPAAS_MAX_CHANNEL_SUBSCRIBERS || 500);

/**
 * Subscribe to a channel. Returns an SSE response object.
 */
export function subscribe(channel) {
  const subscribers = channels.get(channel) || new Set();

  if (subscribers.size >= MAX_SUBSCRIBERS_PER_CHANNEL) {
    return {
      status: 503,
      body: { error: "Too many channel subscribers" },
    };
  }

  let subscriber;

  const stream = new ReadableStream({
    start(controller) {
      if (!channels.has(channel)) {
        channels.set(channel, new Set());
      }

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(": keepalive\n\n");
        } catch {
          cleanup(channel, subscriber);
        }
      }, HEARTBEAT_MS);

      subscriber = { controller, heartbeat };
      channels.get(channel).add(subscriber);
      controller.enqueue("retry: 1000\n\n");
    },
    cancel() {
      cleanup(channel, subscriber);
    },
  });

  return {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
    body: stream,
  };
}

/**
 * Publish data to all subscribers on a channel.
 * Objects are auto-stringified. Formats as SSE `data: ...\n\n`.
 */
export function publish(channel, data) {
  const subs = channels.get(channel);
  if (!subs || subs.size === 0) return;

  const payload = typeof data === "object" ? JSON.stringify(data) : String(data);
  const message = `data: ${payload}\n\n`;

  for (const subscriber of subs) {
    try {
      subscriber.controller.enqueue(message);
    } catch {
      cleanup(channel, subscriber);
    }
  }

  if (subs.size === 0) channels.delete(channel);
}

function cleanup(channel, subscriber) {
  if (!subscriber) return;

  const subs = channels.get(channel);
  if (!subs) return;

  clearInterval(subscriber.heartbeat);
  subs.delete(subscriber);

  if (subs.size === 0) {
    channels.delete(channel);
  }
}
