import { handleRequest } from "./lib/router.js";
import { getSiteByHost, invalidateSitesCache } from "./lib/sites.js";
import { DATA_DIR, TRUST_PROXY } from "./lib/config.js";

// Simple rate limiter (in-memory)
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_EXEMPT_PATHS = new Set(["/health", "/caddy-check"]);

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimits.get(ip);

  if (!record || now - record.start > RATE_LIMIT_WINDOW) {
    rateLimits.set(ip, { start: now, count: 1 });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

function isLoopback(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function shouldTrustForwardedHeaders(peerIp) {
  if (TRUST_PROXY === "always") return true;
  if (TRUST_PROXY === "never") return false;
  return isLoopback(peerIp);
}

function parseForwardedFor(value) {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

function getClientIp(req, server) {
  const peerIp = server?.requestIP?.(req)?.address || "unknown";

  if (!shouldTrustForwardedHeaders(peerIp)) {
    return peerIp;
  }

  return parseForwardedFor(req.headers.get("x-forwarded-for")) ||
    req.headers.get("x-real-ip") ||
    peerIp;
}

// Clean up old rate limit entries periodically
// .unref() allows process to exit even if timer is pending
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimits) {
    if (now - record.start > RATE_LIMIT_WINDOW) {
      rateLimits.delete(ip);
    }
  }
}, 60000).unref();

export async function createHandler() {
  return async function fetch(req, server) {
    const url = new URL(req.url);
    const ip = getClientIp(req, server);

    // Rate limiting
    if (!RATE_LIMIT_EXEMPT_PATHS.has(url.pathname) && !checkRateLimit(ip)) {
      return Response.json(
        { error: "Too many requests, please try again later." },
        { status: 429 }
      );
    }

    // Health check (any host)
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        runtime: "bun",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    }

    // Caddy on-demand TLS check
    if (url.pathname === "/caddy-check") {
      const domain = url.searchParams.get("domain");
      if (!domain) {
        return new Response("Missing domain parameter", { status: 400 });
      }
      // Invalidate cache to always check fresh sites.json
      invalidateSitesCache();
      const site = await getSiteByHost(DATA_DIR, domain);
      return new Response(site ? "OK" : "Not found", {
        status: site?.enabled ? 200 : 404,
      });
    }

    // Main request handler
    try {
      return await handleRequest(req, { dataDir: DATA_DIR, clientIp: ip });
    } catch (err) {
      console.error("Request error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  };
}
