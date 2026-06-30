import { expect, test } from "@playwright/test";
import type { QuickSwitcherBookmark } from "../src/types/quickSwitcher";
import {
  buildRoamPageUrl,
  extractBlockRefUid,
  extractQueryBlockLabel,
  filterBookmarks,
  formatShortcutForDisplay,
  keyboardEventToShortcut,
  moveBookmarkByOffset,
  normalizeQuerySource,
  normalizeShortcut,
  parsePageUidFromUrl,
  parseStoredBookmarks,
  parseStoredQuerySource,
  shortcutHasModifier,
  toAbsoluteUrl,
} from "../src/utils/quickSwitcher";

test("normalizes shortcuts into a consistent order", () => {
  expect(normalizeShortcut({ shortcut: "Shift + Cmd + 2" })).toBe(
    "meta+shift+2",
  );
  expect(normalizeShortcut({ shortcut: "ctrl-alt-k" })).toBe("ctrl+alt+k");
  expect(normalizeShortcut({ shortcut: "ctrl" })).toBeNull();
});

test("builds shortcuts from keyboard events", () => {
  expect(
    keyboardEventToShortcut({
      event: {
        key: "K",
        ctrlKey: true,
        metaKey: false,
        altKey: true,
        shiftKey: false,
      },
    }),
  ).toBe("ctrl+alt+k");
  expect(
    keyboardEventToShortcut({
      event: {
        key: " ",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      },
    }),
  ).toBe("ctrl+space");
});

test("checks whether a shortcut has at least one modifier", () => {
  expect(shortcutHasModifier({ shortcut: "ctrl+1" })).toBe(true);
  expect(shortcutHasModifier({ shortcut: "1" })).toBe(false);
});

test("formats shortcut labels for mac and windows", () => {
  expect(
    formatShortcutForDisplay({
      shortcut: "meta+shift+2",
      isMac: true,
    }),
  ).toBe("Cmd + Shift + 2");
  expect(
    formatShortcutForDisplay({
      shortcut: "meta+shift+2",
      isMac: false,
    }),
  ).toBe("Meta + Shift + 2");
});

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
      pageUid: "alpha",
      shortcut: "ctrl+1",
    },
    {
      id: "2",
      title: "Research Notes",
      url: "https://roamresearch.com/#/app/graph/page/research",
      pageUid: "research",
      shortcut: "ctrl+2",
    },
  ];

  expect(filterBookmarks({ bookmarks, query: "project" })).toHaveLength(1);
  expect(filterBookmarks({ bookmarks, query: "notes" })).toHaveLength(1);
  expect(filterBookmarks({ bookmarks, query: "graph/page" })).toHaveLength(2);
});

test("moves bookmarks while preserving relative order", () => {
  const bookmarks: QuickSwitcherBookmark[] = [
    {
      id: "1",
      title: "One",
      url: "https://roamresearch.com/#/app/graph/page/one",
      pageUid: "one",
      shortcut: "ctrl+1",
    },
    {
      id: "2",
      title: "Two",
      url: "https://roamresearch.com/#/app/graph/page/two",
      pageUid: "two",
      shortcut: "ctrl+2",
    },
    {
      id: "3",
      title: "Three",
      url: "https://roamresearch.com/#/app/graph/page/three",
      pageUid: "three",
      shortcut: "ctrl+3",
    },
  ];

  const moved = moveBookmarkByOffset({ bookmarks, index: 2, offset: -1 });
  expect(moved.map((bookmark) => bookmark.id)).toEqual(["1", "3", "2"]);
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
        title: "Invalid Shortcut",
        url: "https://roamresearch.com/#/app/graph/page/invalid-shortcut",
        shortcut: "Ctrl +",
      },
      {
        id: "id-4",
        title: "Invalid",
        url: "",
        shortcut: "Ctrl + 2",
      },
    ],
  });

  expect(parsed).toHaveLength(2);
  expect(parsed[0].shortcut).toBe("ctrl+1");
  expect(parsed[1].shortcut).toBeNull();
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
    normalizeQuerySource({
      querySource: {
        enabled: true,
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
