import { env } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import { assertPublicUrl } from "./url-safety";

export type FetchedPage = {
  url: string;
  finalUrl: string;
  title: string | null;
  text: string;
  fetchStatus: "fetched" | "snippet_only" | "blocked" | "failed";
};

function stripHtml(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]
    ? titleMatch[1].replace(/\s+/g, " ").trim()
    : null;

  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h1|h2|h3|h4|li|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { title, text: withoutNoise.slice(0, 12_000) };
}

/**
 * Fetch a public webpage with SSRF protections and bounded size.
 * Does not follow redirects blindly — each hop is revalidated.
 */
export async function fetchPublicPage(urlString: string): Promise<FetchedPage> {
  const maxRedirects = 3;
  let current = await assertPublicUrl(urlString);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      env.RESEARCH_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "AI-Playground-ResearchBot/1.0",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            url: urlString,
            finalUrl: current.toString(),
            title: null,
            text: "",
            fetchStatus: "failed",
          };
        }
        const next = new URL(location, current);
        current = await assertPublicUrl(next.toString());
        continue;
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("text/plain") &&
        !contentType.includes("application/xhtml")
      ) {
        return {
          url: urlString,
          finalUrl: current.toString(),
          title: null,
          text: "",
          fetchStatus: "blocked",
        };
      }

      if (!response.ok) {
        return {
          url: urlString,
          finalUrl: current.toString(),
          title: null,
          text: "",
          fetchStatus: "failed",
        };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > env.RESEARCH_MAX_PAGE_BYTES) {
        return {
          url: urlString,
          finalUrl: current.toString(),
          title: null,
          text: "",
          fetchStatus: "blocked",
        };
      }

      const raw = buffer.toString("utf8");
      const { title, text } = stripHtml(raw);
      if (!text) {
        return {
          url: urlString,
          finalUrl: current.toString(),
          title,
          text: "",
          fetchStatus: "failed",
        };
      }

      return {
        url: urlString,
        finalUrl: current.toString(),
        title,
        text,
        fetchStatus: "fetched",
      };
    } catch (error) {
      if (error instanceof AppError) {
        return {
          url: urlString,
          finalUrl: current.toString(),
          title: null,
          text: "",
          fetchStatus: "blocked",
        };
      }
      return {
        url: urlString,
        finalUrl: current.toString(),
        title: null,
        text: "",
        fetchStatus: "failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    url: urlString,
    finalUrl: current.toString(),
    title: null,
    text: "",
    fetchStatus: "failed",
  };
}
