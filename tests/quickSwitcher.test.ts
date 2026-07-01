import { expect, test } from "@playwright/test";
import type { QuickSwitcherBookmark } from "../src/types/quickSwitcher";
import {
  buildRoamPageUrl,
  deriveBlockTitle,
  extractBlockRefUid,
  extractQueryBlockAlias,
  extractQueryBlockLabel,
  filterBookmarks,
  getCommandPaletteCommandLabel,
  normalizeCommandPaletteSettings,
  normalizeQuerySource,
  parsePageUidFromUrl,
  parseStoredBookmarks,
  parseStoredCommandPaletteSettings,
  parseStoredQuerySource,
  resolveActiveQuerySourceUid,
  toAbsoluteUrl,
} from "../src/utils/quickSwitcher";

test("parses a page uid from roam page urls", () => {
  expect(
    parsePageUidFromUrl({
      url: "https://roamresearch.com/#/app/my-graph/page/AbC123xYz",
    }),
  ).toBe("AbC123xYz");
  expect(
    parsePageUidFromUrl({
      url: "https://roamresearch.com/#/app/my-graph/daily-notes",
    }),
  ).toBeNull();
});

test("filters bookmarks by title or url", () => {
  const bookmarks: QuickSwitcherBookmark[] = [
    {
      id: "1",
      title: "Project Alpha",
      url: "https://roamresearch.com/#/app/graph/page/alpha",
      targetType: "page",
      pageUid: "alpha",
      blockUid: null,
    },
    {
      id: "2",
      title: "Research Notes",
      url: "https://roamresearch.com/#/app/graph/page/research",
      targetType: "page",
      pageUid: "research",
      blockUid: null,
    },
  ];

  expect(filterBookmarks({ bookmarks, query: "project" })).toHaveLength(1);
  expect(filterBookmarks({ bookmarks, query: "notes" })).toHaveLength(1);
  expect(filterBookmarks({ bookmarks, query: "graph/page" })).toHaveLength(2);
});

test("parses and sanitizes stored bookmarks", () => {
  const parsed = parseStoredBookmarks({
    value: [
      {
        id: "id-1",
        title: "My Page",
        url: "https://roamresearch.com/#/app/graph/page/uid123",
        shortcut: "Ctrl + 1",
      },
      {
        id: "id-2",
        title: "No Shortcut",
        url: "https://roamresearch.com/#/app/graph/page/no-shortcut",
      },
      {
        id: "id-3",
        title: "A saved block entry with a title",
        targetType: "block",
        blockUid: "block-uid",
        url: "https://roamresearch.com/#/app/graph/page/block-uid",
      },
      {
        id: "id-4",
        title: "Invalid Shortcut",
        url: "https://roamresearch.com/#/app/graph/page/invalid-shortcut",
        shortcut: "Ctrl +",
      },
      {
        id: "id-5",
        title: "Invalid",
        url: "",
        shortcut: "Ctrl + 2",
      },
    ],
  });

  expect(parsed).toHaveLength(4);
  expect(parsed[0].targetType).toBe("page");
  expect(parsed[2].targetType).toBe("block");
  expect(parsed[2].blockUid).toBe("block-uid");
});

test("derives block titles from the first few words", () => {
  expect(
    deriveBlockTitle({
      text: "One two three four five six seven eight nine ten",
      maxWords: 4,
    }),
  ).toBe("One two three four...");
  expect(deriveBlockTitle({ text: "   " })).toBe("Untitled block");
});

test("parses and normalizes command palette settings", () => {
  expect(
    parseStoredCommandPaletteSettings({
      value: {
        enabled: true,
        prefix: "QS: ",
      },
    }),
  ).toEqual({
    enabled: true,
    prefix: "QS: ",
  });
  expect(parseStoredCommandPaletteSettings({ value: "invalid" })).toEqual({
    enabled: false,
    prefix: "QS: ",
  });
  expect(
    normalizeCommandPaletteSettings({
      settings: {
        enabled: true,
        prefix: "",
      },
    }),
  ).toEqual({
    enabled: true,
    prefix: "QS: ",
  });
  expect(
    parseStoredCommandPaletteSettings({
      value: {
        enabled: true,
        prefix: "Q S - ",
      },
    }),
  ).toEqual({
    enabled: true,
    prefix: "QS: ",
  });
});

test("builds command palette labels from prefix and entry title", () => {
  expect(
    getCommandPaletteCommandLabel({
      bookmark: {
        id: "block-1",
        title: "Follow up with team",
        targetType: "block",
        pageUid: null,
        blockUid: "block-1",
        url: "https://roamresearch.com/#/app/graph/page/block-1",
      },
      settings: {
        enabled: true,
        prefix: "QS - ",
      },
    }),
  ).toBe("QS - Follow up with team");
});

test("parses and normalizes query builder source settings", () => {
  expect(
    parseStoredQuerySource({
      value: {
        enabled: true,
        queryRef: "  queries/Active Projects  ",
      },
    }),
  ).toEqual({
    enabled: true,
    queryRef: "queries/Active Projects",
  });
  expect(parseStoredQuerySource({ value: "invalid" })).toEqual({
    enabled: false,
    queryRef: "",
  });
  expect(
    parseStoredQuerySource({
      value: {
        enabled: false,
        queryRef: "queries/Active Projects",
      },
    }),
  ).toEqual({
    enabled: true,
    queryRef: "queries/Active Projects",
  });
  expect(
    normalizeQuerySource({
      querySource: {
        enabled: false,
        queryRef: "  ((abc123def))  ",
      },
    }),
  ).toEqual({
    enabled: true,
    queryRef: "((abc123def))",
  });
});

test("extracts block uids from roam block refs", () => {
  expect(extractBlockRefUid({ value: "Run ((abc123_DEF))" })).toBe(
    "abc123_DEF",
  );
  expect(extractBlockRefUid({ value: "not a block ref" })).toBeNull();
});

test("extracts query builder labels from query block refs", () => {
  expect(
    extractQueryBlockLabel({ value: "{{query block:Active Projects}}" }),
  ).toBe("Active Projects");
  expect(extractQueryBlockLabel({ value: "{{query block}}" })).toBeNull();
  expect(extractQueryBlockLabel({ value: "Active Projects" })).toBeNull();
  expect(
    extractQueryBlockAlias({
      value: "Run {{query block:Active Projects}} from this block",
    }),
  ).toBe("Active Projects");
});

test("resolves query builder source refs against active queries", () => {
  const activeQueries = [
    {
      uid: "query-page-uid",
      title: "queries/Active Projects",
    },
    {
      uid: "query-block-uid",
      text: "Run {{query block:Waiting On}}",
    },
  ];

  expect(
    resolveActiveQuerySourceUid({
      queryRef: "query-page-uid",
      activeQueries,
    }),
  ).toBe("query-page-uid");
  expect(
    resolveActiveQuerySourceUid({
      queryRef: "((query-block-uid))",
      activeQueries,
    }),
  ).toBe("query-block-uid");
  expect(
    resolveActiveQuerySourceUid({
      queryRef: "Active Projects",
      activeQueries,
    }),
  ).toBe("query-page-uid");
  expect(
    resolveActiveQuerySourceUid({
      queryRef: "{{query block:Waiting On}}",
      activeQueries,
    }),
  ).toBe("query-block-uid");
  expect(
    resolveActiveQuerySourceUid({
      queryRef: "Waiting On",
      activeQueries,
    }),
  ).toBe("query-block-uid");
  expect(
    resolveActiveQuerySourceUid({
      queryRef: "Inactive Query",
      activeQueries,
    }),
  ).toBeNull();
});

test("resolves relative urls to absolute urls", () => {
  expect(toAbsoluteUrl({ url: "/#/app/graph/page/abc" })).toContain(
    "/#/app/graph/page/abc",
  );
});

test("builds page urls for a graph", () => {
  expect(
    buildRoamPageUrl({
      pageUid: "abc123",
      graphName: "my-graph",
    }),
  ).toContain("/#/app/my-graph/page/abc123");
});
