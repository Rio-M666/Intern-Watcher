import { createHash } from "node:crypto";
import type {
  ContentField,
  JobContent,
  NormalizedJob,
  RawCell,
  RawRow,
  ScrapeResult,
} from "./types.js";

type FieldAliases = Record<Exclude<ContentField, "sourceUrl">, string[]>;

export const COLUMN_ALIASES: FieldAliases = {
  company: ["企業名", "会社名", "企業", "company"],
  title: ["イベント名", "インターン名", "募集名", "タイトル", "求人名", "title"],
  status: ["募集状況", "応募状況", "ステータス", "status"],
  deadline: ["締め切り", "締切", "応募締切", "エントリー締切", "deadline"],
  category: ["種別", "カテゴリ", "カテゴリー", "タイプ", "category"],
  eligibility: ["募集要件", "応募資格", "対象者", "参加条件", "eligibility"],
  detailUrl: [
    "エントリーはこちらから",
    "エントリーリンク",
    "応募リンク",
    "詳細URL",
    "詳細リンク",
    "HPリンク",
    "URL",
    "url",
  ],
};

const normalizeHeader = (value: string): string =>
  value.normalize("NFKC").toLowerCase().replace(/[\s\-_・/／()（）「」『』]+/g, "");

export const normalizeText = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .trim();

export function canonicalizeUrl(value: string): string | null {
  const cleaned = value.trim().replace(/[\s、。]+$/u, "");
  if (!cleaned) return null;

  try {
    let url = new URL(cleaned);
    if (!/^https?:$/.test(url.protocol)) return null;

    if (/notion\.(?:so|site|com)$/i.test(url.hostname) && /\/redirect$/i.test(url.pathname)) {
      const redirectTarget = url.searchParams.get("url");
      if (redirectTarget) url = new URL(redirectTarget);
    }

    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|yclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

const findMatchingCells = (row: RawRow, aliases: string[]): RawCell[] => {
  const wanted = new Set(aliases.map(normalizeHeader));
  return Object.entries(row.properties)
    .filter(([header]) => wanted.has(normalizeHeader(header)))
    .map(([, cell]) => cell);
};

const readText = (row: RawRow, aliases: string[]): string => {
  const values = findMatchingCells(row, aliases)
    .map((cell) => normalizeText(cell.text))
    .filter(Boolean);
  return [...new Set(values)].join("\n");
};

const readUrl = (row: RawRow, aliases: string[]): string | null => {
  const cells = findMatchingCells(row, aliases);
  const candidates = cells.flatMap((cell) => [
    ...cell.urls,
    ...(cell.text.match(/https?:\/\/[^\s<>"')\]]+/gu) ?? []),
  ]);
  for (const candidate of candidates) {
    const canonical = canonicalizeUrl(candidate);
    if (canonical) return canonical;
  }
  return null;
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const stableJson = (content: JobContent): string =>
  JSON.stringify({
    company: content.company,
    title: content.title,
    status: content.status,
    deadline: content.deadline,
    category: content.category,
    eligibility: content.eligibility,
    detailUrl: content.detailUrl,
    sourceUrl: content.sourceUrl,
  });

export function normalizeRow(row: RawRow, sourceUrl: string): NormalizedJob | null {
  const company = readText(row, COLUMN_ALIASES.company);
  const title = readText(row, COLUMN_ALIASES.title);
  if (!company || !title) return null;

  const status = readText(row, COLUMN_ALIASES.status) || null;
  const deadline = readText(row, COLUMN_ALIASES.deadline) || null;
  const category = readText(row, COLUMN_ALIASES.category) || null;
  const eligibility = readText(row, COLUMN_ALIASES.eligibility) || null;
  const detailUrl = readUrl(row, COLUMN_ALIASES.detailUrl);
  const canonicalSource = canonicalizeUrl(sourceUrl) ?? sourceUrl;

  const content: JobContent = {
    company,
    title,
    status,
    deadline,
    category,
    eligibility,
    detailUrl,
    sourceUrl: canonicalSource,
  };
  const identity = detailUrl
    ? `url:${detailUrl}`
    : `fallback:${normalizeText(company).toLowerCase()}\u001f${normalizeText(title).toLowerCase()}\u001f${normalizeText(deadline ?? "").toLowerCase()}`;

  return {
    id: sha256(identity),
    contentHash: sha256(stableJson(content)),
    ...content,
  };
}

export function normalizeScrape(result: ScrapeResult): NormalizedJob[] {
  const unique = new Map<string, NormalizedJob>();
  for (const row of result.rows) {
    const job = normalizeRow(row, result.sourceUrl);
    if (job) unique.set(job.id, job);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.company.localeCompare(right.company, "ja") ||
      left.title.localeCompare(right.title, "ja") ||
      left.id.localeCompare(right.id),
  );
}
