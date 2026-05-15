export function isDev() {
  return process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL;
}
