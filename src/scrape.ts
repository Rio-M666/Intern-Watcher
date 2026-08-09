import type { Locator, Page } from "playwright";
import type { RawCell, RawRow, ScrapeResult, SourceInfo } from "./types.js";

const TABLE_HEADER_SELECTOR = ".notion-table-view-header-row";
const TABLE_ROW_SELECTOR = ".notion-table-view-row";
const TABLE_CELL_SELECTOR = ".notion-table-view-cell";
const DEFAULT_MAX_SCROLLS = 160;
// Some Notion rows contain long descriptions and can be several viewports tall.
// A generous limit prevents a tall row from looking like the end of the list.
const DEFAULT_STAGNANT_LIMIT = 12;

interface ScrollState {
  before: number;
  after: number;
  max: number;
  atBottom: boolean;
}

interface HorizontalScrollState {
  before: number;
  after: number;
  max: number;
  atEnd: boolean;
}

const compactText = (value: string): string =>
  value.normalize("NFKC").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();

const mergeRows = (existing: RawRow | undefined, incoming: RawRow): RawRow => {
  if (!existing) return incoming;

  const properties = { ...existing.properties };
  for (const [header, cell] of Object.entries(incoming.properties)) {
    const previous = properties[header];
    properties[header] = {
      text: cell.text || previous?.text || "",
      urls: [...new Set([...(previous?.urls ?? []), ...cell.urls])],
    };
  }
  return { rowKey: existing.rowKey, properties };
};

async function detectChallenge(page: Page): Promise<void> {
  const title = compactText(await page.title());
  const body = compactText((await page.locator("body").innerText().catch(() => "")).slice(0, 2_000));
  const challenge =
    /しばらくお待ちください|Just a moment|Checking your browser|Cloudflare/i.test(title) ||
    /captcha|turnstile|セキュリティ確認/i.test(body);
  if (challenge) {
    throw new Error(
      "公開Notionがブラウザ確認画面を返しました。CAPTCHAやbot対策の回避は行わず終了します",
    );
  }
}

async function selectInternshipView(page: Page): Promise<void> {
  const internshipTab = page.getByRole("tab", { name: "インターン", exact: true });
  if ((await internshipTab.count()) === 0) return;

  const selected = await internshipTab.first().getAttribute("aria-selected");
  if (selected !== "true") {
    await internshipTab.first().click({ timeout: 15_000 });
    await page.waitForTimeout(1_500);
  }
}

async function waitForDatabase(page: Page): Promise<void> {
  try {
    await page.locator(TABLE_HEADER_SELECTOR).first().waitFor({
      state: "visible",
      timeout: 45_000,
    });
  } catch (error) {
    await detectChallenge(page);
    throw new Error(`Notionのデータベース表を検出できませんでした: ${String(error)}`);
  }
}

async function readHeaders(page: Page): Promise<string[]> {
  const headerRow = page.locator(TABLE_HEADER_SELECTOR).first();
  let headers = await headerRow.locator(".notion-table-view-header-cell").allInnerTexts();
  if (headers.length === 0) {
    headers = await headerRow.locator(":scope > div > div").allInnerTexts();
  }
  return headers.map(compactText).filter(Boolean);
}

async function extractRenderedRows(rows: Locator, headers: string[]): Promise<RawRow[]> {
  return rows.evaluateAll((rowNodes, expectedHeaders) => {
    const urlPattern = /https?:\/\/[^\s<>"')\]]+/gu;

    return rowNodes.flatMap((row, rowIndex) => {
      const rowElement = row as HTMLElement;
      let cells = Array.from(rowElement.querySelectorAll<HTMLElement>(":scope > .notion-table-view-cell"));
      if (cells.length === 0) {
        cells = Array.from(rowElement.querySelectorAll<HTMLElement>(".notion-table-view-cell"));
      }
      if (cells.length === 0) {
        const candidates = [rowElement, ...Array.from(rowElement.querySelectorAll<HTMLElement>("div"))];
        const container = candidates
          .filter((candidate) => candidate.children.length >= Math.min(expectedHeaders.length, 3))
          .sort(
            (left, right) =>
              Math.abs(left.children.length - expectedHeaders.length) -
              Math.abs(right.children.length - expectedHeaders.length),
          )[0];
        cells = container
          ? Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
          : [];
      }

      if (cells.length < 2) return [];

      const properties: Record<string, { text: string; urls: string[] }> = {};
      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index];
        const dataColumnIndex = Number.parseInt(cell?.getAttribute("data-col-index") ?? "", 10);
        const columnIndex = Number.isFinite(dataColumnIndex) ? dataColumnIndex : index;
        const header = expectedHeaders[columnIndex];
        if (!cell || !header) continue;

        const text = (cell.innerText || cell.textContent || "")
          .normalize("NFKC")
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+/g, " ")
          .trim();
        const urls = new Set<string>();
        for (const element of cell.querySelectorAll<HTMLElement>("a[href], [data-href], [data-url]")) {
          const candidate =
            (element as HTMLAnchorElement).href ||
            element.getAttribute("data-href") ||
            element.getAttribute("data-url");
          if (candidate?.startsWith("http://") || candidate?.startsWith("https://")) urls.add(candidate);
        }
        for (const match of text.match(urlPattern) ?? []) urls.add(match);
        properties[header] = { text, urls: [...urls] };
      }

      const identityElement =
        rowElement.closest<HTMLElement>("[data-block-id], [data-id]") ??
        rowElement.querySelector<HTMLElement>("[data-block-id], [data-id]");
      const explicitKey =
        rowElement.getAttribute("data-block-id") ||
        rowElement.getAttribute("data-id") ||
        identityElement?.getAttribute("data-block-id") ||
        identityElement?.getAttribute("data-id") ||
        rowElement.id;
      const textKey = expectedHeaders
        .slice(0, 4)
        .map((header) => properties[header]?.text ?? "")
        .join("\u001f")
        .slice(0, 1_500);
      const rowKey = explicitKey || textKey || `rendered-row-${rowIndex}`;

      return [{ rowKey, properties }];
    });
  }, headers);
}

async function findScroller(page: Page): Promise<Locator> {
  const semanticScroller = page.locator(".notion-scroller.vertical").first();
  if ((await semanticScroller.count()) > 0) return semanticScroller;

  const fallback = page.locator("body *").filter({
    has: page.locator(TABLE_HEADER_SELECTOR),
  }).first();
  if ((await fallback.count()) > 0) return fallback;
  throw new Error("Notionデータベースのスクロール領域を検出できませんでした");
}

async function advanceScroller(scroller: Locator): Promise<ScrollState> {
  return scroller.evaluate((element) => {
    const node = element as HTMLElement;
    const before = node.scrollTop;
    const max = Math.max(0, node.scrollHeight - node.clientHeight);
    const step = Math.max(400, Math.floor(node.clientHeight * 0.8));
    node.scrollTop = Math.min(max, before + step);
    const after = node.scrollTop;
    return {
      before,
      after,
      max,
      atBottom: max === 0 || after >= max - 2,
    };
  });
}

async function advanceHorizontalScroller(scroller: Locator): Promise<HorizontalScrollState> {
  return scroller.evaluate((element) => {
    const node = element as HTMLElement;
    const before = node.scrollLeft;
    const max = Math.max(0, node.scrollWidth - node.clientWidth);
    const step = Math.max(600, Math.floor(node.clientWidth * 0.8));
    node.scrollLeft = Math.min(max, before + step);
    const after = node.scrollLeft;
    return {
      before,
      after,
      max,
      atEnd: max === 0 || after >= max - 2,
    };
  });
}

async function collectHorizontalSweep(
  page: Page,
  scroller: Locator,
  headers: string[],
  collected: Map<string, RawRow>,
): Promise<void> {
  await scroller.evaluate((element) => {
    (element as HTMLElement).scrollLeft = 0;
  });

  for (let horizontalIndex = 0; horizontalIndex < 20; horizontalIndex += 1) {
    const batch = await extractRenderedRows(page.locator(TABLE_ROW_SELECTOR), headers);
    for (const row of batch) collected.set(row.rowKey, mergeRows(collected.get(row.rowKey), row));

    const state = await advanceHorizontalScroller(scroller);
    if (state.atEnd) {
      if (state.after !== state.before) {
        await page.waitForTimeout(250);
        const finalBatch = await extractRenderedRows(page.locator(TABLE_ROW_SELECTOR), headers);
        for (const row of finalBatch) {
          collected.set(row.rowKey, mergeRows(collected.get(row.rowKey), row));
        }
      }
      break;
    }
    await page.waitForTimeout(250);
  }

  await scroller.evaluate((element) => {
    (element as HTMLElement).scrollLeft = 0;
  });
}

export async function scrapeNotionDatabase(
  page: Page,
  source: SourceInfo,
): Promise<ScrapeResult> {
  await page.goto(source.notionUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForTimeout(2_000);
  await detectChallenge(page);
  await waitForDatabase(page);
  await selectInternshipView(page);
  await detectChallenge(page);
  await waitForDatabase(page);

  const headers = await readHeaders(page);
  if (headers.length < 3) {
    throw new Error(`Notionのカラムを十分に取得できませんでした（${headers.length}件）`);
  }

  const scroller = await findScroller(page);
  await scroller.evaluate((element) => {
    (element as HTMLElement).scrollTop = 0;
  });
  await page.waitForTimeout(500);

  const collected = new Map<string, RawRow>();
  const maxScrolls = Math.min(
    500,
    Math.max(1, Number.parseInt(process.env.MAX_SCROLLS ?? String(DEFAULT_MAX_SCROLLS), 10)),
  );
  let stagnantRounds = 0;

  for (let scrollIndex = 0; scrollIndex < maxScrolls; scrollIndex += 1) {
    const beforeCount = collected.size;
    await collectHorizontalSweep(page, scroller, headers, collected);
    stagnantRounds = collected.size === beforeCount ? stagnantRounds + 1 : 0;

    const scrollState = await advanceScroller(scroller);
    if (scrollState.atBottom && stagnantRounds >= 2) break;
    if (stagnantRounds >= DEFAULT_STAGNANT_LIMIT) break;
    if (scrollState.after === scrollState.before && scrollState.atBottom) {
      stagnantRounds += 1;
    }
    await page.waitForTimeout(600);
  }

  await collectHorizontalSweep(page, scroller, headers, collected);

  if (collected.size === 0) {
    throw new Error("Notionデータベースから求人行を1件も取得できませんでした");
  }

  return {
    headers,
    rows: [...collected.values()],
    sourceUrl: source.notionUrl,
  };
}
