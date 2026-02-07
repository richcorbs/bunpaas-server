// Centralized configuration
export const DATA_DIR = process.env.RICHHOST_DATA_DIR || "/var/www";
export const isDev = process.env.NODE_ENV === "development";
export const PORT = process.env.RICHHOST_PORT || (isDev ? 7001 : 443);
