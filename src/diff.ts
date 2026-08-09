import {
  CONTENT_FIELDS,
  type ContentField,
  type CurrentData,
  type DiffResult,
  type FeedData,
  type FeedItem,
  type JobRecord,
  type NormalizedJob,
} from "./types.js";
import { normalizeContentHashValue } from "./normalize.js";

export const FEED_RETENTION_DAYS = 14;

const changedFields = (previous: JobRecord, current: NormalizedJob): ContentField[] =>
  CONTENT_FIELDS.filter(
    (field) =>
      normalizeContentHashValue(previous[field]) !== normalizeContentHashValue(current[field]),
  );

const populatedFields = (job: NormalizedJob): ContentField[] =>
  CONTENT_FIELDS.filter((field) => job[field] !== null && job[field] !== "");

const toFeedItem = (
  record: JobRecord,
  changeType: "new" | "updated",
  updatedAt: string,
  fields: ContentField[],
): FeedItem => ({
  id: record.id,
  changeType,
  firstSeenAt: record.firstSeenAt,
  updatedAt,
  changedFields: fields,
  company: record.company,
  title: record.title,
  deadline: record.deadline,
  detailUrl: record.detailUrl,
});

export function diffJobs(
  jobs: NormalizedJob[],
  previous: CurrentData,
  generatedAt: string,
  sourceUrl: string,
): DiffResult {
  const previousById = new Map(previous.jobs.map((job) => [job.id, job]));
  const currentJobs: JobRecord[] = [];
  const feedEvents: FeedItem[] = [];
  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const job of jobs) {
    const oldJob = previousById.get(job.id);
    const fields = oldJob ? changedFields(oldJob, job) : [];
    const record: JobRecord = {
      ...job,
      firstSeenAt: oldJob?.firstSeenAt ?? generatedAt,
      lastSeenAt: generatedAt,
    };
    currentJobs.push(record);

    if (!oldJob) {
      newCount += 1;
      feedEvents.push(toFeedItem(record, "new", generatedAt, populatedFields(job)));
    } else if (oldJob.contentHash !== job.contentHash && fields.length > 0) {
      updatedCount += 1;
      feedEvents.push(toFeedItem(record, "updated", generatedAt, fields));
    } else {
      unchangedCount += 1;
    }
  }

  return {
    current: {
      generatedAt,
      sourceUrl,
      jobs: currentJobs,
    },
    feedEvents,
    newCount,
    updatedCount,
    unchangedCount,
  };
}

export function mergeFeed(
  previous: FeedData,
  events: FeedItem[],
  generatedAt: string,
): FeedData {
  const cutoff = new Date(generatedAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - FEED_RETENTION_DAYS);

  const retained = [...previous.items, ...events].filter((item) => {
    const timestamp = Date.parse(item.updatedAt);
    return Number.isFinite(timestamp) && timestamp >= cutoff.getTime();
  });
  const unique = new Map<string, FeedItem>();
  for (const item of retained) {
    unique.set(`${item.id}\u001f${item.changeType}\u001f${item.updatedAt}`, item);
  }

  return {
    generatedAt,
    retentionDays: FEED_RETENTION_DAYS,
    items: [...unique.values()].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.company.localeCompare(right.company, "ja"),
    ),
  };
}

export function assertPlausibleCount(previousCount: number, currentCount: number): void {
  if (currentCount === 0) {
    throw new Error("正規化後の求人件数が0件のため、既存データを更新しません");
  }
  if (previousCount >= 20 && currentCount < previousCount * 0.6) {
    throw new Error(
      `取得件数の異常減少を検出しました（前回${previousCount}件、今回${currentCount}件、閾値${Math.ceil(previousCount * 0.6)}件）`,
    );
  }
}
