import { expect, test } from "@playwright/test";
import type { QuickSwitcherBookmark } from "../src/types/quickSwitcher";
import {
  buildRoamPageUrl,
  deriveBlockTitle,
  extractBlockRefUid,
  filterBookmarks,
  getBookmarkRowPresentation,
  getCommandPaletteCommandLabel,
  normalizeCommandPaletteSettings,
  parsePageUidFromUrl,
  parseStoredBookmarks,
  parseStoredCommandPaletteSettings,
  toAbsoluteUrl,
} from "../src/utils/quickSwitcher";
import {
  createBookmarkFromSuggestion,
  getBlockBreadcrumbsFromPull,
  getSavedTargetKeys,
  resolveEntryInput,
  searchEntries,
} from "../src/utils/quickSwitcherEntries";

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
      alias: "Lab notebook",
      url: "https://roamresearch.com/#/app/graph/page/research",
      targetType: "page",
      pageUid: "research",
      blockUid: null,
    },
  ];

  expect(filterBookmarks({ bookmarks, query: "project" })).toHaveLength(1);
  expect(filterBookmarks({ bookmarks, query: "lab" })).toHaveLength(1);
  expect(filterBookmarks({ bookmarks, query: "notes" })).toHaveLength(1);
  expect(filterBookmarks({ bookmarks, query: "graph/page" })).toHaveLength(2);
});

test("hides original titles only when a bookmark has an alias", () => {
  const baseBookmark: QuickSwitcherBookmark = {
    id: "block-1",
    title: "Meeting Notes {{Today:SmartBlock:DevMeetingToday}}",
    url: "https://roamresearch.com/#/app/graph/page/block-1",
    targetType: "block",
    pageUid: null,
    blockUid: "block-1",
    breadcrumbs: ["Sync", "Dev team"],
  };

  expect(getBookmarkRowPresentation({ bookmark: baseBookmark })).toEqual({
    title: "Meeting Notes {{Today:SmartBlock:DevMeetingToday}}",
  });
  expect(
    getBookmarkRowPresentation({
      bookmark: { ...baseBookmark, alias: "Dev Team" },
    }),
  ).toEqual({
    title: "Dev Team",
    originalTitle: "Meeting Notes {{Today:SmartBlock:DevMeetingToday}}",
  });
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
        alias: "Block alias",
        targetType: "block",
        blockUid: "block-uid",
        breadcrumbs: ["Daily Notes", "Parent block"],
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
  expect(parsed[2].alias).toBe("Block alias");
  expect(parsed[2].blockUid).toBe("block-uid");
  expect(parsed[2].breadcrumbs).toEqual(["Daily Notes", "Parent block"]);
});

test("builds saved target keys and bookmarks from entry suggestions", () => {
  const bookmarks: QuickSwitcherBookmark[] = [
    {
      id: "id-1",
      title: "Existing Page",
      targetType: "page",
      pageUid: "existing-page",
      blockUid: null,
      url: "https://roamresearch.com/#/app/graph/page/existing-page",
    },
    {
      id: "id-2",
      title: "Follow up block",
      targetType: "block",
      pageUid: null,
      blockUid: "follow-up",
      url: "https://roamresearch.com/#/app/graph/page/follow-up",
    },
  ];

  expect(getSavedTargetKeys({ bookmarks })).toEqual(
    new Set(["page:existing-page", "block:follow-up"]),
  );
  expect(
    createBookmarkFromSuggestion({
      id: "new-block",
      suggestion: {
        uid: "new-block-uid",
        title: "New block",
        targetType: "block",
        breadcrumbs: ["Daily Notes", "Parent block"],
        url: "https://roamresearch.com/#/app/graph/page/new-block-uid",
      },
    }),
  ).toEqual({
    id: "new-block",
    title: "New block",
    targetType: "block",
    pageUid: null,
    blockUid: "new-block-uid",
    breadcrumbs: ["Daily Notes", "Parent block"],
    url: "https://roamresearch.com/#/app/graph/page/new-block-uid",
  });
});

test("searches a bounded frontend result set and filters saved targets", async () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: "https://roamresearch.com/#/app/test-graph/daily-notes",
        origin: "https://roamresearch.com",
      },
      roamAlphaAPI: {
        data: {
          pull: (): null => null,
        },
      },
    },
    writable: true,
  });

  try {
    let receivedOptions: Record<string, unknown> = {};
    const pageResults = Array.from({ length: 10 }, (_, index) => ({
      ":block/uid": `page-${index}`,
      ":node/title": `Project page ${index}`,
    }));
    const blockResults = Array.from({ length: 10 }, (_, index) => ({
      ":block/string": `Project block ${index}`,
      ":block/uid": `block-${index}`,
    }));

    const suggestions = await searchEntries({
      query: "  project  ",
      savedTargetKeys: new Set(["page:page-0", "block:block-0"]),
      searchApi: async (options) => {
        receivedOptions = options;
        return pageResults.flatMap((page, index) => [
          page,
          blockResults[index],
        ]);
      },
    });

    expect(receivedOptions).toEqual({
      "hide-code-blocks": false,
      limit: 50,
      pull: "[:block/string :node/title :block/uid]",
      "search-blocks": true,
      "search-pages": true,
      "search-str": "project",
    });
    expect(suggestions).toHaveLength(16);
    expect(
      suggestions.filter(({ targetType }) => targetType === "page"),
    ).toHaveLength(8);
    expect(
      suggestions.filter(({ targetType }) => targetType === "block"),
    ).toHaveLength(8);
    expect(
      suggestions.some(
        ({ targetType, uid }) => `${targetType}:${uid}` === "page:page-0",
      ),
    ).toBe(false);
    expect(
      suggestions.some(
        ({ targetType, uid }) => `${targetType}:${uid}` === "block:block-0",
      ),
    ).toBe(false);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
      writable: true,
    });
  }
});

test("resolves an exact block reference to an unsaved Manage search result", async () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: "https://roamresearch.com/#/app/test-graph/daily-notes",
        origin: "https://roamresearch.com",
      },
      roamAlphaAPI: {
        data: {
          backend: {
            q: async (query: string): Promise<[string][]> =>
              query.includes("?page :node/title ?title")
                ? [["Resolved project page"]]
                : [],
          },
          pull: (): null => null,
        },
      },
    },
    writable: true,
  });

  try {
    let textSearchCalled = false;
    const suggestions = await searchEntries({
      query: "  ((acW-i9uMD))  ",
      savedTargetKeys: new Set(),
      searchApi: async () => {
        textSearchCalled = true;
        return [];
      },
    });

    expect(textSearchCalled).toBe(false);
    expect(suggestions).toEqual([
      {
        uid: "acW-i9uMD",
        title: "Resolved project page",
        targetType: "page",
        url: "https://roamresearch.com/#/app/test-graph/page/acW-i9uMD",
      },
    ]);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
      writable: true,
    });
  }
});

test("resolves an exact block reference to an unsaved block result", async () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: "https://roamresearch.com/#/app/test-graph/daily-notes",
        origin: "https://roamresearch.com",
      },
      roamAlphaAPI: {
        data: {
          backend: {
            q: async (query: string): Promise<[string][]> =>
              query.includes("?block :block/string ?text")
                ? [["Follow up with the project team tomorrow"]]
                : [],
          },
          pull: (): Record<string, unknown> => ({
            ":block/page": { ":node/title": "Projects" },
          }),
        },
      },
    },
    writable: true,
  });

  try {
    const suggestions = await searchEntries({
      query: "((acW-i9uMD))",
      savedTargetKeys: new Set(),
      searchApi: async () => {
        throw new Error("Text search should not run for a resolved block ref");
      },
    });

    expect(suggestions).toEqual([
      {
        breadcrumbs: ["Projects"],
        uid: "acW-i9uMD",
        title: "Follow up with the project team tomorrow",
        targetType: "block",
        url: "https://roamresearch.com/#/app/test-graph/page/acW-i9uMD",
      },
    ]);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
      writable: true,
    });
  }
});

test("preserves Manage text search for saved, unresolved, invalid, and bare UID inputs", async () => {
  const originalWindow = globalThis.window;
  let uidResolutionQueries = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: "https://roamresearch.com/#/app/test-graph/daily-notes",
        origin: "https://roamresearch.com",
      },
      roamAlphaAPI: {
        data: {
          backend: {
            q: async (query: string): Promise<[string][]> => {
              uidResolutionQueries += 1;
              if (
                query.includes('"savedUid1"') &&
                query.includes("?page :node/title ?title")
              ) {
                return [["Saved page"]];
              }
              return [];
            },
          },
          pull: (): null => null,
        },
      },
    },
    writable: true,
  });

  try {
    let textSearches = 0;
    const searchApi = async (): Promise<Record<string, unknown>[]> => {
      textSearches += 1;
      return [];
    };
    const savedSuggestions = await searchEntries({
      query: "((savedUid1))",
      savedTargetKeys: new Set(["page:savedUid1"]),
      searchApi,
    });
    expect(savedSuggestions).toEqual([]);

    await searchEntries({
      query: "((missing01))",
      savedTargetKeys: new Set(),
      searchApi,
    });
    const queriesAfterUnresolvedRef = uidResolutionQueries;
    await searchEntries({
      query: "((short))",
      savedTargetKeys: new Set(),
      searchApi,
    });
    await searchEntries({
      query: "acW-i9uMD",
      savedTargetKeys: new Set(),
      searchApi,
    });

    expect(textSearches).toBe(4);
    expect(uidResolutionQueries).toBe(queriesAfterUnresolvedRef);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
      writable: true,
    });
  }
});

test("does not resolve a bare UID through the entry input UID path", async () => {
  const originalWindow = globalThis.window;
  const queries: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: "https://roamresearch.com/#/app/test-graph/daily-notes",
        origin: "https://roamresearch.com",
      },
      roamAlphaAPI: {
        data: {
          backend: {
            q: async (query: string): Promise<[string][]> => {
              queries.push(query);
              return [];
            },
          },
          pull: (): null => null,
        },
      },
    },
    writable: true,
  });

  try {
    expect(await resolveEntryInput({ value: "acW-i9uMD" })).toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('?page :node/title "acW-i9uMD"');
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
      writable: true,
    });
  }
});

test("extracts block breadcrumbs from pulled block parents", () => {
  expect(
    getBlockBreadcrumbsFromPull({
      block: {
        ":block/page": {
          ":node/title": "December 3rd, 2023",
        },
        ":block/parents": [
          {
            ":block/string": "Untitled - test (12/3/2023, 4:31:21 PM)",
          },
          {
            ":node/title": "December 3rd, 2023",
          },
        ],
      },
    }),
  ).toEqual(["December 3rd, 2023", "Untitled - test (12/3/2023, 4:31:21 PM)"]);
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
        alias: "Team follow-up",
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
  ).toBe("QS - Team follow-up (Follow up with team)");
});

test("extracts block uids from roam block refs", () => {
  expect(extractBlockRefUid({ value: "Run ((abc123_DEF))" })).toBe(
    "abc123_DEF",
  );
  expect(extractBlockRefUid({ value: "not a block ref" })).toBeNull();
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
