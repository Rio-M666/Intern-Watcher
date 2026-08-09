import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeUrl, normalizeRow } from "../src/normalize.js";
import type { RawRow } from "../src/types.js";

test("canonicalizeUrl removes fragments and tracking parameters", () => {
  assert.equal(
    canonicalizeUrl("https://Example.com/jobs/42/?utm_source=test&ref=top#entry"),
    "https://example.com/jobs/42?ref=top",
  );
});

test("normalizeRow creates a stable ID from the canonical detail URL", () => {
  const makeRow = (url: string): RawRow => ({
    rowKey: "row-1",
    properties: {
      企業名: { text: " 株式会社 Example ", urls: [] },
      イベント名: { text: "開発インターン", urls: [] },
      締め切り: { text: "2026/08/31", urls: [] },
      HPリンク: { text: "応募", urls: [url] },
    },
  });

  const first = normalizeRow(
    makeRow("https://example.com/jobs/42?utm_source=a"),
    "https://example.notion.site/database?v=view",
  );
  const second = normalizeRow(
    makeRow("https://example.com/jobs/42?utm_source=b#entry"),
    "https://example.notion.site/database?v=view",
  );

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.id, second.id);
  assert.equal(first.contentHash, second.contentHash);
});

test("normalizeRow falls back to company, title and deadline for its ID", () => {
  const row: RawRow = {
    rowKey: "virtual-row",
    properties: {
      企業名: { text: "Example株式会社", urls: [] },
      イベント名: { text: "サマーインターン", urls: [] },
      締切: { text: "2026-09-01", urls: [] },
    },
  };
  const first = normalizeRow(row, "https://example.notion.site/db");
  const second = normalizeRow({ ...row, rowKey: "another-render-key" }, "https://example.notion.site/db");

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.id, second.id);
});

const contentRow = (overrides: Record<string, string> = {}): RawRow => ({
  rowKey: "content-row",
  properties: {
    企業名: { text: overrides.company ?? "Example株式会社", urls: [] },
    イベント名: { text: overrides.title ?? "開発インターン", urls: [] },
    締め切り: { text: overrides.deadline ?? "2026/08/31", urls: [] },
    募集要件: { text: overrides.eligibility ?? "大学生・大学院生", urls: [] },
    HPリンク: { text: "応募", urls: ["https://example.com/jobs/42"] },
  },
});

test("contentHash ignores emoji, invisible characters and whitespace-only differences", () => {
  const decorated = normalizeRow(
    contentRow({
      company: "Example\uFE0F 株式会社",
      title: "開発  🚀  インターン\u200B",
      eligibility: "大学生  \n\n  大学院生✨",
    }),
    "https://example.notion.site/db",
  );
  const plain = normalizeRow(
    contentRow({
      company: "Example 株式会社",
      title: "開発\nインターン",
      eligibility: "大学生 大学院生",
    }),
    "https://example.notion.site/db",
  );

  assert.ok(decorated);
  assert.ok(plain);
  assert.notEqual(decorated.title, plain.title, "display values should remain distinct");
  assert.equal(decorated.id, plain.id);
  assert.equal(decorated.contentHash, plain.contentHash);
});

test("contentHash changes when the actual title changes", () => {
  const before = normalizeRow(contentRow({ title: "開発インターン" }), "https://example.notion.site/db");
  const after = normalizeRow(contentRow({ title: "研究インターン" }), "https://example.notion.site/db");

  assert.ok(before);
  assert.ok(after);
  assert.notEqual(before.contentHash, after.contentHash);
});

test("contentHash changes when the actual deadline changes", () => {
  const before = normalizeRow(contentRow({ deadline: "2026/08/31" }), "https://example.notion.site/db");
  const after = normalizeRow(contentRow({ deadline: "2026/09/01" }), "https://example.notion.site/db");

  assert.ok(before);
  assert.ok(after);
  assert.notEqual(before.contentHash, after.contentHash);
});

test("contentHash changes when the actual eligibility changes", () => {
  const before = normalizeRow(contentRow({ eligibility: "大学生・大学院生" }), "https://example.notion.site/db");
  const after = normalizeRow(contentRow({ eligibility: "大学院生のみ" }), "https://example.notion.site/db");

  assert.ok(before);
  assert.ok(after);
  assert.notEqual(before.contentHash, after.contentHash);
});
