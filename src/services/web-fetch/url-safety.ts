import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "../../middleware/error-handler";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80")) return true;
  return false;
}

export function assertPublicHostname(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) {
    throw new AppError(400, "URL host is required");
  }
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new AppError(400, "Fetching internal hosts is not allowed");
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4 && isPrivateIpv4(host)) {
    throw new AppError(400, "Fetching private IP addresses is not allowed");
  }
  if (ipVersion === 6 && isPrivateIpv6(host)) {
    throw new AppError(400, "Fetching private IP addresses is not allowed");
  }
}

export async function assertPublicUrl(urlString: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new AppError(400, "Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(400, "Only http and https URLs are allowed");
  }

  assertPublicHostname(url.hostname);

  const ipVersion = isIP(url.hostname);
  if (ipVersion === 0) {
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = await lookup(url.hostname, { all: true, verbatim: true });
    } catch {
      throw new AppError(400, `Unable to resolve host ${url.hostname}`);
    }

    if (addresses.length === 0) {
      throw new AppError(400, `Unable to resolve host ${url.hostname}`);
    }

    for (const entry of addresses) {
      if (entry.family === 4 && isPrivateIpv4(entry.address)) {
        throw new AppError(400, "Resolved host points to a private network");
      }
      if (entry.family === 6 && isPrivateIpv6(entry.address)) {
        throw new AppError(400, "Resolved host points to a private network");
      }
    }
  }

  return url;
}

export function canonicalizeUrl(urlString: string): string {
  const url = new URL(urlString);
  url.hash = "";
  // Drop common tracking params
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach(
    (key) => url.searchParams.delete(key),
  );
  return url.toString();
}

export function extractDomain(urlString: string): string {
  try {
    return new URL(urlString).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
