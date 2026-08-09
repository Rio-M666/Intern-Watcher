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
