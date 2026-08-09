import type { Page } from "playwright";
import type { SourceInfo } from "./types.js";

export const OFFICIAL_SITE_URL = "https://magic-spreadsheets.github.io/";

const isNotionUrl = (href: string): boolean => {
  try {
    const hostname = new URL(href).hostname.toLowerCase();
    return (
      hostname === "notion.so" ||
      hostname.endsWith(".notion.so") ||
      hostname === "notion.site" ||
      hostname.endsWith(".notion.site") ||
      hostname === "notion.com" ||
      hostname.endsWith(".notion.com")
    );
  } catch {
    return false;
  }
};

const normalizeLabel = (value: string): string =>
  value.normalize("NFKC").replace(/\s+/g, " ").trim();

export async function discover2026Source(
  page: Page,
  officialUrl = OFFICIAL_SITE_URL,
): Promise<SourceInfo> {
  await page.goto(officialUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.locator("a[href]").first().waitFor({ state: "attached", timeout: 20_000 });

  const links = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
      href: (anchor as HTMLAnchorElement).href,
    })),
  );

  const candidates = links
    .map((link) => ({ ...link, text: normalizeLabel(link.text) }))
    .filter((link) => isNotionUrl(link.href) && /2026/.test(link.text))
    .sort((left, right) => {
      const score = (value: { text: string; href: string }): number =>
        (/魔法のスプレ[ッツ]?[トド]シート/.test(value.text) ? 4 : 0) +
        (/2026/.test(value.text) ? 2 : 0) +
        (/[?&]v=/.test(value.href) ? 1 : 0);
      return score(right) - score(left);
    });

  const target = candidates[0];
  if (!target) {
    throw new Error(
      "公式サイトから『魔法のスプレッドシート2026』の公開Notionリンクを発見できませんでした",
    );
  }

  return {
    officialUrl,
    notionUrl: target.href,
    linkText: target.text,
  };
}
