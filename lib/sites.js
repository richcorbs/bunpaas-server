import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { isDev } from "./config.js";

// In-memory cache for sites.json
let sitesCache = null;
let sitesCacheMtime = 0;

// Cache for site.json configs (per-site)
const siteConfigCache = new Map(); // sitePath -> { config, mtime }

/**
 * Get the path to sites.json
 */
function getSitesPath(dataDir) {
  return path.join(dataDir, "sites.json");
}

/**
 * Load sites.json with caching
 * - In production: trust cache after first load (only our writes invalidate)
 * - In dev: check mtime for external changes
 */
export async function loadSites(dataDir) {
  // Production: return cache immediately if we have it
  if (!isDev && sitesCache) {
    return sitesCache;
  }

  const sitesPath = getSitesPath(dataDir);

  try {
    // Dev mode: check mtime for external changes
    if (isDev && sitesCache) {
      const stat = await fs.stat(sitesPath);
      if (stat.mtimeMs === sitesCacheMtime) {
        return sitesCache;
      }
    }

    const content = await fs.readFile(sitesPath, "utf8");
    sitesCache = JSON.parse(content);

    if (isDev) {
      const stat = await fs.stat(sitesPath);
      sitesCacheMtime = stat.mtimeMs;
    }

    return sitesCache;
  } catch (err) {
    if (err.code === "ENOENT") {
      return { sites: {} };
    }
    throw err;
  }
}

/**
 * Save sites.json atomically (write to temp, rename)
 */
export async function saveSites(dataDir, data) {
  const sitesPath = getSitesPath(dataDir);
  const tempPath = sitesPath + ".tmp";

  // Write to temp file, then atomic rename
  await fs.writeFile(tempPath, JSON.stringify(data), "utf8");
  await fs.rename(tempPath, sitesPath);

  // Update cache (no need to stat - we just wrote it)
  sitesCache = data;

  return data;
}

/**
 * Get all sites
 */
export async function getSites(dataDir) {
  const data = await loadSites(dataDir);
  return data.sites || {};
}

/**
 * Get a site by host
 */
export async function getSiteByHost(dataDir, host) {
  const sites = await getSites(dataDir);
  return sites[host] || null;
}

/**
 * Create a new site
 */
export async function createSite(dataDir, host, options = {}) {
  const data = await loadSites(dataDir);

  if (data.sites[host]) {
    throw new Error(`Site ${host} already exists`);
  }

  const deployKey = generateDeployKey();

  data.sites[host] = {
    enabled: true,
    deployKey,
    env: options.env || {},
    created: new Date().toISOString(),
    lastDeploy: null,
  };

  await saveSites(dataDir, data);

  // Create site directory structure
  const siteDir = path.join(dataDir, "sites", host);
  const deploysDir = path.join(siteDir, "deploys");
  await fs.mkdir(deploysDir, { recursive: true });

  return { ...data.sites[host], host };
}

/**
 * Update a site
 */
export async function updateSite(dataDir, host, updates) {
  const data = await loadSites(dataDir);

  if (!data.sites[host]) {
    throw new Error(`Site ${host} not found`);
  }

  data.sites[host] = { ...data.sites[host], ...updates };
  await saveSites(dataDir, data);

  return data.sites[host];
}

/**
 * Delete a site
 */
export async function deleteSite(dataDir, host) {
  const data = await loadSites(dataDir);

  if (!data.sites[host]) {
    throw new Error(`Site ${host} not found`);
  }

  delete data.sites[host];
  await saveSites(dataDir, data);

  // Optionally delete site directory (dangerous, so we leave it)
  // const siteDir = path.join(dataDir, "sites", host);
  // await fs.rm(siteDir, { recursive: true });

  return { deleted: true, host };
}

/**
 * Update site environment variables
 */
export async function updateSiteEnv(dataDir, host, env) {
  const data = await loadSites(dataDir);

  if (!data.sites[host]) {
    throw new Error(`Site ${host} not found`);
  }

  data.sites[host].env = env;
  await saveSites(dataDir, data);

  return data.sites[host].env;
}

/**
 * Get site environment variables
 */
export async function getSiteEnv(dataDir, host) {
  const site = await getSiteByHost(dataDir, host);
  return site?.env || {};
}

/**
 * Load site.json from a site's current directory (with caching)
 * - In production: cache indefinitely (cleared on deploy via clearSiteConfigCache)
 * - In dev: check mtime for external changes
 */
export async function getSiteConfig(sitePath) {
  const cached = siteConfigCache.get(sitePath);

  // Production: return cache immediately if we have it
  if (!isDev && cached) {
    return cached.config;
  }

  const configPath = path.join(sitePath, "site.json");

  try {
    // Dev mode: check mtime for external changes
    if (isDev && cached) {
      const stat = await fs.stat(configPath);
      if (cached.mtime === stat.mtimeMs) {
        return cached.config;
      }
    }

    const content = await fs.readFile(configPath, "utf8");
    const config = JSON.parse(content);

    if (isDev) {
      const stat = await fs.stat(configPath);
      siteConfigCache.set(sitePath, { config, mtime: stat.mtimeMs });
    } else {
      siteConfigCache.set(sitePath, { config, mtime: 0 });
    }

    return config;
  } catch (err) {
    if (err.code === "ENOENT") {
      siteConfigCache.set(sitePath, { config: null, mtime: 0 });
      return null;
    }
    throw err;
  }
}

/**
 * Clear site config cache for a specific site (call after deploy)
 */
export function clearSiteConfigCache(sitePath) {
  siteConfigCache.delete(sitePath);
}

function generateKey(prefix) {
  return prefix + crypto.randomBytes(32).toString("hex");
}

const generateDeployKey = () => generateKey("dk_");
export const generateApiKey = () => generateKey("ak_");

/**
 * Invalidate the sites cache (call after external changes)
 */
export function invalidateSitesCache() {
  sitesCache = null;
  sitesCacheMtime = 0;
}

