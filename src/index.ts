import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { diffJobs, mergeFeed, assertPlausibleCount, FEED_RETENTION_DAYS } from "./diff.js";
import { discover2026Source } from "./discover.js";
import { normalizeScrape } from "./normalize.js";
import { scrapeNotionDatabase } from "./scrape.js";
import type { CurrentData, FeedData, StatusData } from "./types.js";

const SCRAPER_VERSION = "1.0.0";
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const DEBUG_DIR = path.join(ROOT_DIR, "debug");
const CURRENT_PATH = path.join(DATA_DIR, "current.json");
const FEED_PATH = path.join(DATA_DIR, "feed.json");
const STATUS_PATH = path.join(DATA_DIR, "status.json");

const EMPTY_CURRENT: CurrentData = { generatedAt: null, sourceUrl: null, jobs: [] };
const EMPTY_FEED: FeedData = {
  generatedAt: null,
  retentionDays: FEED_RETENTION_DAYS,
  items: [],
};

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`${path.relative(ROOT_DIR, filePath)}を読み込めませんでした: ${String(error)}`);
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function saveDebugArtifacts(page: Page | undefined, error: unknown): Promise<void> {
  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(path.join(DEBUG_DIR, "error.txt"), `${String(error)}\n`, "utf8").catch(() => undefined);
  if (!page || page.isClosed()) return;
  await page.screenshot({ path: path.join(DEBUG_DIR, "screenshot.png"), timeout: 15_000 }).catch(() => undefined);
  const html = await page.content().catch(() => "");
  if (html) await writeFile(path.join(DEBUG_DIR, "page.html"), html, "utf8").catch(() => undefined);
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(DEBUG_DIR, { recursive: true });

  const previousCurrent = await readJson(CURRENT_PATH, EMPTY_CURRENT);
  const previousFeed = await readJson(FEED_PATH, EMPTY_FEED);
  let browser: Browser | undefined;
  let page: Page | undefined;
  let sourceUrl: string | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "ja-JP",
      viewport: { width: 1440, height: 900 },
    });
    page = await context.newPage();

    const source = await discover2026Source(page);
    sourceUrl = source.notionUrl;
    console.log(`Discovered 2026 database: ${source.notionUrl}`);

    const scrapeResult = await scrapeNotionDatabase(page, source);
    const jobs = normalizeScrape(scrapeResult);
    assertPlausibleCount(previousCurrent.jobs.length, jobs.length);

    const diff = diffJobs(jobs, previousCurrent, generatedAt, scrapeResult.sourceUrl);
    const feed = mergeFeed(previousFeed, diff.feedEvents, generatedAt);
    const status: StatusData = {
      generatedAt,
      success: true,
      sourceCount: jobs.length,
      newCount: diff.newCount,
      updatedCount: diff.updatedCount,
      scraperVersion: SCRAPER_VERSION,
      sourceUrl,
      error: null,
    };

    await writeJsonAtomic(CURRENT_PATH, diff.current);
    await writeJsonAtomic(FEED_PATH, feed);
    await writeJsonAtomic(STATUS_PATH, status);

    console.log(
      `Scraped ${jobs.length} jobs (new: ${diff.newCount}, updated: ${diff.updatedCount}, unchanged: ${diff.unchangedCount})`,
    );
  } catch (error) {
    await saveDebugArtifacts(page, error);
    const status: StatusData = {
      generatedAt,
      success: false,
      sourceCount: 0,
      newCount: 0,
      updatedCount: 0,
      scraperVersion: SCRAPER_VERSION,
      sourceUrl,
      error: error instanceof Error ? error.message : String(error),
    };
    await writeJsonAtomic(STATUS_PATH, status).catch(() => undefined);
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
