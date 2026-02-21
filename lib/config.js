// Centralized configuration
export const DATA_DIR = process.env.BUNPAAS_DATA_DIR || "/var/www";
export const isDev = process.env.NODE_ENV === "development";
export const PORT = Number(process.env.BUNPAAS_PORT || 7001);
export const TRUST_PROXY = (process.env.BUNPAAS_TRUST_PROXY || "loopback").toLowerCase();
