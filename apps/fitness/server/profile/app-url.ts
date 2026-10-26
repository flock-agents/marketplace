// Where the platform serves this app (/a/<app id>), and its full address as the viewer or agent reached it: never written
// in the code, so a copy made from the template under any name links to itself.
const env = process.env;

/** "/a/<app id>", from the platform's own launch environment. */
export const basePath = (): string => (env.APP_BASE_PATH ?? (env.APP_ID ? `/a/${env.APP_ID}` : "")).replace(/\/+$/, "");

/** The app's own API path, as the coach's curl calls use it after $FLOCK_API_URL: "/a/<app id>/api". */
export const apiPath = (): string => `${basePath()}/api`;

/** The app's address with a trailing slash, from the request's forwarded host: links shared in chat open the exact page. */
export function appUrl(headers: { get(name: string): string | null | undefined }, requestUrl: string): string {
  const url = new URL(requestUrl);
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? url.host;
  const proto = headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}${basePath()}/`;
}
