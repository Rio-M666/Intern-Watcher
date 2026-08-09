export const CONTENT_FIELDS = [
  "company",
  "title",
  "status",
  "deadline",
  "category",
  "eligibility",
  "detailUrl",
  "sourceUrl",
] as const;

export type ContentField = (typeof CONTENT_FIELDS)[number];
export type ChangeType = "new" | "updated";

export interface SourceInfo {
  officialUrl: string;
  notionUrl: string;
  linkText: string;
}

export interface RawCell {
  text: string;
  urls: string[];
}

export interface RawRow {
  rowKey: string;
  properties: Record<string, RawCell>;
}

export interface ScrapeResult {
  headers: string[];
  rows: RawRow[];
  sourceUrl: string;
}

export interface JobContent {
  company: string;
  title: string;
  status: string | null;
  deadline: string | null;
  category: string | null;
  eligibility: string | null;
  detailUrl: string | null;
  sourceUrl: string;
}

export interface NormalizedJob extends JobContent {
  id: string;
  contentHash: string;
}

export interface JobRecord extends NormalizedJob {
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface CurrentData {
  generatedAt: string | null;
  sourceUrl: string | null;
  jobs: JobRecord[];
}

export interface FeedItem {
  id: string;
  changeType: ChangeType;
  firstSeenAt: string;
  updatedAt: string;
  changedFields: ContentField[];
  company: string;
  title: string;
  deadline: string | null;
  detailUrl: string | null;
}

export interface FeedData {
  generatedAt: string | null;
  retentionDays: number;
  items: FeedItem[];
}

export interface StatusData {
  generatedAt: string;
  success: boolean;
  sourceCount: number;
  newCount: number;
  updatedCount: number;
  scraperVersion: string;
  sourceUrl: string | null;
  error: string | null;
}

export interface DiffResult {
  current: CurrentData;
  feedEvents: FeedItem[];
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
}
