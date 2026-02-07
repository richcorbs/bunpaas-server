import { createHandler } from "./app.js";
import { PORT } from "./lib/config.js";
import { shutdown as shutdownLogs } from "./lib/logs.js";

const handler = await createHandler();

const server = Bun.serve({
  port: PORT,
  fetch: handler,
});

console.log(`Bun server running at http://localhost:${server.port}`);

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  server.stop();
  await shutdownLogs();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  server.stop();
  await shutdownLogs();
  process.exit(0);
});

// Hot reload on SIGUSR2
// Note: In dev with --watch, file changes auto-restart. SIGUSR2 is for production deploys.
process.on("SIGUSR2", async () => {
  console.log("SIGUSR2 received, restarting...");
  server.stop();
  process.exit(0);  // Let systemd/process manager restart us
});
