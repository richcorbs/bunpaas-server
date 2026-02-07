// Centralized configuration
export const DATA_DIR = process.env.BUNPAAS_DATA_DIR || "/var/www";
export const isDev = process.env.NODE_ENV === "development";
export const PORT = process.env.BUNPAAS_PORT || (isDev ? 7001 : 443);
