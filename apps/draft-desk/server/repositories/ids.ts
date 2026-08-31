// Shared id generator for all repositories — `prefix_<20 hex-ish chars>`.
export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
