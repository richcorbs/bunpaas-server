/**
 * Real-time channels for SSE pub/sub
 *
 * Functions use req.subscribe(channel) and req.publish(channel, data)
 * to enable real-time communication between clients.
 */

const channels = new Map(); // channel -> Set<controller>

/**
 * Subscribe to a channel. Returns an SSE response object.
 */
export function subscribe(channel) {
  let ctrl;

  const stream = new ReadableStream({
    start(controller) {
      ctrl = controller;
      if (!channels.has(channel)) {
        channels.set(channel, new Set());
      }
      channels.get(channel).add(controller);
      controller.enqueue("retry: 1000\n\n");
    },
    cancel() {
      const subs = channels.get(channel);
      if (subs) {
        subs.delete(ctrl);
        if (subs.size === 0) channels.delete(channel);
      }
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

  for (const controller of subs) {
    try {
      controller.enqueue(message);
    } catch {
      subs.delete(controller);
    }
  }

  if (subs.size === 0) channels.delete(channel);
}
