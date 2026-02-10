import path from "path";
import { getSiteEnv, clearSiteConfigCache } from "./sites.js";
import { DATA_DIR, isDev } from "./config.js";

const FUNCTION_TIMEOUT = 60000;

// Caches (cleared on deploy)
const functionCache = new Map();
const functionPathCache = new Map();

/**
 * Handle a function request - returns Response or null
 */
export async function handleFunction(req, ctx) {
  const { sitePath, host, siteConfig } = ctx;
  const functionsDir = path.join(sitePath, "_functions");

  // Check if functions directory exists
  const dir = Bun.file(functionsDir);
  if (!(await dirExists(functionsDir))) {
    return null;
  }

  // Find matching function
  const functionFile = await findFunctionFile(functionsDir, ctx.path);
  if (!functionFile) return null;

  // Load function module
  const functionModule = await loadFunction(functionFile.path);
  if (!functionModule) return null;

  // Get handler for method
  const methodName = req.method.toLowerCase();
  const handler =
    functionModule[methodName] ||
    (methodName === "delete" ? functionModule.del : null) ||
    functionModule.default;

  if (!handler || typeof handler !== "function") return null;

  // Get env and build request object for function
  const env = await getSiteEnv(DATA_DIR, host);

  // Parse body based on content type
  let body = null;
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      body = await req.json();
    } catch {
      body = null;
    }
  } else if (contentType.includes("application/octet-stream")) {
    body = Buffer.from(await req.arrayBuffer());
  } else if (contentType.includes("text/")) {
    body = await req.text();
  }

  const funcReq = {
    method: req.method,
    path: ctx.path,
    query: ctx.query,
    headers: ctx.headers,
    body,
    params: functionFile.params,
    env,
  };

  // Execute with timeout
  const timeout = siteConfig?.functionTimeout || FUNCTION_TIMEOUT;

  try {
    const result = await executeWithTimeout(handler(funcReq), timeout);
    return buildResponse(result);
  } catch (err) {
    if (err.message === "Function timeout") {
      return Response.json({ error: "Function timed out" }, { status: 504 });
    }
    console.error(`Function error in ${functionFile.path}:`, err);
    return Response.json({ error: "Internal function error" }, { status: 500 });
  }
}

function buildResponse(result) {
  if (!result) {
    return new Response(null, { status: 204 });
  }

  const status = result.status || 200;
  const headers = new Headers(result.headers || {});
  const body = result.body;

  if (body === undefined || body === null) {
    return new Response(null, { status, headers });
  }

  if (body instanceof ReadableStream) {
    return new Response(body, { status, headers });
  }

  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return new Response(body, { status, headers });
  }

  if (typeof body === "object") {
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(body), { status, headers });
  }

  return new Response(String(body), { status, headers });
}

async function findFunctionFile(functionsDir, reqPath) {
  const cacheKey = `${functionsDir}:${reqPath}`;

  if (!isDev && functionPathCache.has(cacheKey)) {
    return functionPathCache.get(cacheKey);
  }

  const result = await findFunctionFileUncached(functionsDir, reqPath);

  if (!isDev) {
    functionPathCache.set(cacheKey, result);
  }

  return result;
}

async function findFunctionFileUncached(functionsDir, reqPath) {
  const segments = reqPath.replace(/^\//, "").split("/").filter(Boolean);
  if (segments.length === 0) segments.push("index");

  // Try direct match
  const directPath = path.join(functionsDir, ...segments) + ".js";
  if (await fileExists(directPath)) {
    return { path: directPath, params: {} };
  }

  // Try index
  const indexPath = path.join(functionsDir, ...segments, "index.js");
  if (await fileExists(indexPath)) {
    return { path: indexPath, params: {} };
  }

  // Try dynamic routes
  return findDynamicRoute(functionsDir, segments, {});
}

async function findDynamicRoute(baseDir, segments, params) {
  if (segments.length === 0) return null;

  const [current, ...rest] = segments;

  // Try exact directory
  const exactDir = path.join(baseDir, current);
  if (await dirExists(exactDir)) {
    if (rest.length === 0) {
      const indexPath = path.join(exactDir, "index.js");
      if (await fileExists(indexPath)) {
        return { path: indexPath, params };
      }
    } else {
      const directFile = path.join(exactDir, ...rest) + ".js";
      if (await fileExists(directFile)) {
        return { path: directFile, params };
      }
      const result = await findDynamicRoute(exactDir, rest, params);
      if (result) return result;
    }
  }

  // Try dynamic routes
  try {
    const entries = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: baseDir, onlyFiles: false }));

    for (const name of entries) {
      const fullPath = path.join(baseDir, name);
      const isDir = await dirExists(fullPath);

      const dirMatch = name.match(/^\[(\w+)\]$/);
      if (dirMatch && isDir) {
        const paramName = dirMatch[1];
        const newParams = { ...params, [paramName]: current };
        const dynamicDir = fullPath;

        if (rest.length === 0) {
          const indexPath = path.join(dynamicDir, "index.js");
          if (await fileExists(indexPath)) {
            return { path: indexPath, params: newParams };
          }
        } else {
          const directFile = path.join(dynamicDir, ...rest) + ".js";
          if (await fileExists(directFile)) {
            return { path: directFile, params: newParams };
          }
          const result = await findDynamicRoute(dynamicDir, rest, newParams);
          if (result) return result;
        }
      }

      const fileMatch = name.match(/^\[(\w+)\]\.js$/);
      if (fileMatch && !isDir && rest.length === 0) {
        return {
          path: fullPath,
          params: { ...params, [fileMatch[1]]: current },
        };
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return null;
}

async function loadFunction(functionPath) {
  try {
    // Resolve symlinks to get real path and mtime
    const fs = await import("fs/promises");
    const realPath = await fs.realpath(functionPath);
    const stat = await fs.stat(realPath);
    const mtime = stat.mtimeMs;

    // Cache key includes mtime for automatic invalidation
    const cacheKey = `${realPath}:${mtime}`;

    if (functionCache.has(cacheKey)) {
      return functionCache.get(cacheKey);
    }

    // Import with mtime query param to bust Bun's module cache
    const module = await import(realPath + `?t=${mtime}`);
    functionCache.set(cacheKey, module);
    return module;
  } catch (err) {
    console.error(`Error loading function ${functionPath}:`, err);
    return null;
  }
}

function executeWithTimeout(promise, timeout) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Function timeout")), timeout)
    ),
  ]);
}

async function fileExists(filePath) {
  return Bun.file(filePath).exists();
}

async function dirExists(dirPath) {
  try {
    const file = Bun.file(dirPath);
    // Bun.file().exists() returns false for directories, so we use stat
    const stat = await Bun.file(dirPath).stat?.() || null;
    return stat === null ? false : (await import("fs/promises")).stat(dirPath).then(s => s.isDirectory()).catch(() => false);
  } catch {
    return false;
  }
}

export function clearFunctionCache(siteHost) {
  if (!siteHost) {
    functionCache.clear();
    functionPathCache.clear();
    return;
  }

  const sitePrefix = path.join(DATA_DIR, "sites", siteHost);
  for (const key of functionCache.keys()) {
    // Key format is now "realPath:mtime", extract path part
    const keyPath = key.split(':')[0];
    if (keyPath.startsWith(sitePrefix)) {
      functionCache.delete(key);
    }
  }
  for (const key of functionPathCache.keys()) {
    if (key.startsWith(sitePrefix)) {
      functionPathCache.delete(key);
    }
  }
}
