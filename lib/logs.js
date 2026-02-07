import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "./config.js";

const pendingLogs = new Map();
let flushTimer = null;
const FLUSH_INTERVAL = 10000;
const MAX_LOGS = 20;

/**
 * Log a request (buffered, flushed periodically)
 */
export function logRequest(host, entry) {
  if (!pendingLogs.has(host)) {
    pendingLogs.set(host, []);
  }
  pendingLogs.get(host).push(entry);

  if (!flushTimer) {
    flushTimer = setTimeout(flushLogs, FLUSH_INTERVAL);
  }
}

/**
 * Get request logs for a site
 */
export async function getRequestLogs(host) {
  const logFile = path.join(DATA_DIR, "logs", `${host}.json`);
  try {
    const content = await fs.readFile(logFile, "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function flushLogs() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingLogs.size === 0) return;

  const logsDir = path.join(DATA_DIR, "logs");

  try {
    await fs.mkdir(logsDir, { recursive: true });

    for (const [host, entries] of pendingLogs) {
      const logFile = path.join(logsDir, `${host}.json`);
      let existing = [];
      try {
        const content = await fs.readFile(logFile, "utf8");
        existing = JSON.parse(content);
      } catch {
        // File doesn't exist
      }
      const combined = [...entries, ...existing].slice(0, MAX_LOGS);
      await fs.writeFile(logFile, JSON.stringify(combined, null, 2));
    }
    pendingLogs.clear();
  } catch (err) {
    console.error("Error flushing logs:", err);
  }
}

/**
 * Flush logs immediately and clear timer (call on shutdown)
 */
export async function shutdown() {
  await flushLogs();
}
