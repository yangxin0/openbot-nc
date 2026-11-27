import { realpathSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";

const WEB_CLIENT_PATH = "/app";

const INDEX_FILE = "index.html";
const ASSETS_SEGMENT = "assets";
const HASHED_ASSET = /[-.][A-Za-z0-9_-]{8,}\.[a-z0-9]+$/u;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE = "no-cache";

const WEB_CLIENT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": WEB_CLIENT_CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(self), payment=(), usb=()",
  "X-Robots-Tag": "noindex, nofollow",
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

class WebClientDirectoryError extends Error {}

export function isWebClientPath(pathname: string): boolean {
  return pathname === WEB_CLIENT_PATH || pathname.startsWith(`${WEB_CLIENT_PATH}/`);
}

export function createWebClientHandler(directory: string): (request: Request) => Response {
  const root = readRoot(directory);
  const index = join(root, INDEX_FILE);
  return (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return plain(405, "Method not allowed", { Allow: "GET, HEAD" });
    }
    const segments = pathSegments(new URL(request.url).pathname);
    if (segments === null) return plain(404, "Not found");
    const file = segments.length === 0 ? index : existingFile(root, segments);
    if (file !== null) return fileResponse(request, file, cacheControl(root, file));
    if (segments[0] === ASSETS_SEGMENT || extname(segments.at(-1) ?? "") !== "") return plain(404, "Not found");
    return fileResponse(request, index, REVALIDATE_CACHE);
  };
}

function readRoot(directory: string): string {
  let root: string;
  try {
    root = realpathSync(directory);
  } catch {
    throw new WebClientDirectoryError(`RELAY_WEB_CLIENT_DIR does not exist: ${directory}`);
  }
  if (!statSync(root).isDirectory()) {
    throw new WebClientDirectoryError(`RELAY_WEB_CLIENT_DIR is not a folder: ${directory}`);
  }
  if (!isFile(join(root, INDEX_FILE))) {
    throw new WebClientDirectoryError(`RELAY_WEB_CLIENT_DIR has no ${INDEX_FILE}: ${directory}`);
  }
  return root;
}

function pathSegments(pathname: string): string[] | null {
  const rest = pathname.slice(WEB_CLIENT_PATH.length);
  if (rest !== "" && !rest.startsWith("/")) return null;
  const segments: string[] = [];
  for (const raw of rest.split("/")) {
    if (raw === "") continue;
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === "." || segment === ".." || /[/\\\0]/u.test(segment)) return null;
    segments.push(segment);
  }
  return segments;
}

function existingFile(root: string, segments: readonly string[]): string | null {
  let real: string;
  try {
    real = realpathSync(join(root, ...segments));
  } catch {
    return null;
  }
  if (!real.startsWith(`${root}${sep}`)) return null;
  return isFile(real) ? real : null;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function cacheControl(root: string, file: string) {
  const relative = file.slice(root.length + 1);
  return relative.startsWith(`${ASSETS_SEGMENT}${sep}`) && HASHED_ASSET.test(relative)
    ? IMMUTABLE_CACHE
    : REVALIDATE_CACHE;
}

function fileResponse(request: Request, file: string, cache: string): Response {
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": cache,
  };
  const body = Bun.file(file);
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(body.size) } });
  }
  return new Response(body, { status: 200, headers });
}

function plain(status: number, text: string, extra: Record<string, string> = {}): Response {
  return new Response(text, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": REVALIDATE_CACHE,
      ...extra,
    },
  });
}
