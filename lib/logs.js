import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "./config.js";

const requestLogs = new Map();
let requestFlushTimer = null;
const REQUEST_FLUSH_INTERVAL = 10000;
const MAX_REQUEST_LOGS = 20;

const deployLogs = new Map();
let deployFlushTimer = null;
const DEPLOY_FLUSH_INTERVAL = 5000;
const MAX_DEPLOY_LOGS = 50;

/**
 * Log a request (buffered, flushed periodically)
 */
export function logRequest(host, entry) {
  if (!requestLogs.has(host)) {
    requestLogs.set(host, []);
  }
  requestLogs.get(host).push(entry);

  if (!requestFlushTimer) {
    requestFlushTimer = setTimeout(flushRequestLogs, REQUEST_FLUSH_INTERVAL);
  }
}

/**
 * Log a deploy event (buffered, flushed periodically)
 */
export function logDeploy(host, entry) {
  if (!deployLogs.has(host)) {
    deployLogs.set(host, []);
  }
  deployLogs.get(host).push(entry);

  if (!deployFlushTimer) {
    deployFlushTimer = setTimeout(flushDeployLogs, DEPLOY_FLUSH_INTERVAL);
  }
}

/**
 * Get request logs for a site
 */
export async function getRequestLogs(host) {
  const logFile = path.join(DATA_DIR, "logs", `${host}-requests.json`);
  try {
    const content = await fs.readFile(logFile, "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Get deploy logs for a site
 */
export async function getDeployLogs(host) {
  const logFile = path.join(DATA_DIR, "logs", `${host}-deploys.json`);
  try {
    const content = await fs.readFile(logFile, "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function flushRequestLogs() {
  if (requestFlushTimer) {
    clearTimeout(requestFlushTimer);
    requestFlushTimer = null;
  }
  if (requestLogs.size === 0) return;

  const logsDir = path.join(DATA_DIR, "logs");

  try {
    await fs.mkdir(logsDir, { recursive: true });

    for (const [host, entries] of requestLogs) {
      const logFile = path.join(logsDir, `${host}-requests.json`);
      let existing = [];
      try {
        const content = await fs.readFile(logFile, "utf8");
        existing = JSON.parse(content);
      } catch {
        // File doesn't exist
      }
      const combined = [...entries, ...existing].slice(0, MAX_REQUEST_LOGS);
      await fs.writeFile(logFile, JSON.stringify(combined, null, 2));
    }
    requestLogs.clear();
  } catch (err) {
    console.error("Error flushing request logs:", err);
  }
}

async function flushDeployLogs() {
  if (deployFlushTimer) {
    clearTimeout(deployFlushTimer);
    deployFlushTimer = null;
  }
  if (deployLogs.size === 0) return;

  const logsDir = path.join(DATA_DIR, "logs");

  try {
    await fs.mkdir(logsDir, { recursive: true });

    for (const [host, entries] of deployLogs) {
      const logFile = path.join(logsDir, `${host}-deploys.json`);
      let existing = [];
      try {
        const content = await fs.readFile(logFile, "utf8");
        existing = JSON.parse(content);
      } catch {
        // File doesn't exist
      }
      const combined = [...entries, ...existing].slice(0, MAX_DEPLOY_LOGS);
      await fs.writeFile(logFile, JSON.stringify(combined, null, 2));
    }
    deployLogs.clear();
  } catch (err) {
    console.error("Error flushing deploy logs:", err);
  }
}

/**
 * Flush logs immediately and clear timers (call on shutdown)
 */
export async function shutdown() {
  await flushRequestLogs();
  await flushDeployLogs();
}
