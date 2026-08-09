import assert from "node:assert/strict";
import test from "node:test";
import { assertPlausibleCount, diffJobs, mergeFeed } from "../src/diff.js";
import type { CurrentData, FeedData, JobRecord, NormalizedJob } from "../src/types.js";

const NOW = "2026-08-09T00:00:00.000Z";

const job = (overrides: Partial<NormalizedJob> = {}): NormalizedJob => ({
  id: "job-1",
  contentHash: "hash-1",
  company: "Example株式会社",
  title: "開発インターン",
  status: "募集中",
  deadline: "2026/08/31",
  category: "インターン",
  eligibility: "大学生",
  detailUrl: "https://example.com/jobs/1",
  sourceUrl: "https://example.notion.site/db",
  ...overrides,
});

const record = (overrides: Partial<JobRecord> = {}): JobRecord => ({
  ...job(),
  firstSeenAt: "2026-08-01T00:00:00.000Z",
  lastSeenAt: "2026-08-08T00:00:00.000Z",
  ...overrides,
});

test("diffJobs classifies new, updated and unchanged records", () => {
  const previous: CurrentData = {
    generatedAt: "2026-08-08T00:00:00.000Z",
    sourceUrl: "https://example.notion.site/db",
    jobs: [record(), record({ id: "job-2", contentHash: "old-hash", title: "旧タイトル" })],
  };
  const result = diffJobs(
    [
      job(),
      job({ id: "job-2", contentHash: "new-hash", title: "新タイトル" }),
      job({ id: "job-3", contentHash: "hash-3", title: "新規求人" }),
    ],
    previous,
    NOW,
    "https://example.notion.site/db",
  );

  assert.equal(result.unchangedCount, 1);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.newCount, 1);
  assert.deepEqual(result.feedEvents.find((item) => item.id === "job-2")?.changedFields, ["title"]);
  assert.equal(result.current.jobs[0]?.firstSeenAt, "2026-08-01T00:00:00.000Z");
  assert.equal(result.current.jobs[0]?.lastSeenAt, NOW);
});

test("mergeFeed keeps recent history and removes events older than 14 days", () => {
  const previous: FeedData = {
    generatedAt: "2026-08-08T00:00:00.000Z",
    retentionDays: 14,
    items: [
      {
        id: "old",
        changeType: "new",
        firstSeenAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z",
        changedFields: ["company"],
        company: "Old",
        title: "Old",
        deadline: null,
        detailUrl: null,
      },
      {
        id: "recent",
        changeType: "updated",
        firstSeenAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        changedFields: ["deadline"],
        company: "Recent",
        title: "Recent",
        deadline: null,
        detailUrl: null,
      },
    ],
  };

  const merged = mergeFeed(previous, [], NOW);
  assert.deepEqual(merged.items.map((item) => item.id), ["recent"]);
});

test("assertPlausibleCount rejects an abnormal decrease", () => {
  assert.throws(() => assertPlausibleCount(20, 11), /異常減少/);
  assert.doesNotThrow(() => assertPlausibleCount(20, 12));
  assert.throws(() => assertPlausibleCount(0, 0), /0件/);
});
