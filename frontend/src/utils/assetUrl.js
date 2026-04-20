/**
 * Resolve asset URLs so they work when the app is served from a subpath
 * (e.g. /assets/badria_pwa/pwa/). Vite sets import.meta.env.BASE_URL from the build base.
 */
export function assetUrl(path) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  const cleanPath = (path || '').replace(/^\//, '');
  return `${base}${cleanPath}`;
}
