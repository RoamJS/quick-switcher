import type {
  QuickSwitcherBookmark,
  QuickSwitcherTargetType,
} from "~/types/quickSwitcher";
import {
  buildRoamPageUrl,
  createBookmarkId,
  deriveBlockTitle,
  extractBlockRefUid,
  getBookmarkTargetType,
  getBookmarkTargetUid,
  parsePageUidFromUrl,
} from "~/utils/quickSwitcher";

export type QuickSwitcherEntrySuggestion = {
  uid: string;
  title: string;
  targetType: QuickSwitcherTargetType;
  url: string;
  breadcrumbs?: string[];
};

type PulledRoamBlock = Record<string, unknown>;

type RoamSearchResult = Record<string, unknown>;

type RoamSearchOptions = {
  "hide-code-blocks": boolean;
  limit: number;
  pull: string;
  "search-blocks": boolean;
  "search-pages": boolean;
  "search-str": string;
};

type RoamSearchApi = (
  options: RoamSearchOptions,
) => Promise<RoamSearchResult[]>;

const MAX_PAGE_SUGGESTIONS = 8;
const MAX_BLOCK_SUGGESTIONS = 8;
const MAX_SEARCH_RESULTS = 50;
const SEARCH_RESULT_PULL = "[:block/string :node/title :block/uid]";

const toDatalogString = ({ value }: { value: string }): string =>
  JSON.stringify(value);

const isPulledRoamBlock = (value: unknown): value is PulledRoamBlock =>
  typeof value === "object" && value !== null;

const getSearchResultValue = ({
  key,
  result,
}: {
  key: ":block/string" | ":block/uid" | ":node/title";
  result: RoamSearchResult;
}): string => {
  const value = result[key];
  return typeof value === "string" ? value : "";
};

const normalizeBreadcrumbSegment = ({ value }: { value: string }): string =>
  value.replace(/\s+/g, " ").trim();

const getPulledBlockLabel = ({ block }: { block: PulledRoamBlock }): string => {
  const pageTitle = block[":node/title"];
  if (typeof pageTitle === "string" && pageTitle.trim()) {
    return normalizeBreadcrumbSegment({ value: pageTitle });
  }

  const blockText = block[":block/string"];
  if (typeof blockText === "string" && blockText.trim()) {
    return deriveBlockTitle({
      text: normalizeBreadcrumbSegment({ value: blockText }),
      maxWords: 8,
    });
  }

  return "";
};

const isPageUrlInput = ({ entry }: { entry: string }): boolean =>
  /^https?:\/\//i.test(entry) ||
  entry.startsWith("#/") ||
  entry.startsWith("/#/");

const getUidFromEntryInput = ({ value }: { value: string }): string => {
  const normalizedValue = value.trim();
  return (
    extractBlockRefUid({ value: normalizedValue }) ||
    (isPageUrlInput({ entry: normalizedValue })
      ? parsePageUidFromUrl({ url: normalizedValue })
      : normalizedValue) ||
    ""
  );
};

export const getSuggestionTargetKey = ({
  suggestion,
}: {
  suggestion: QuickSwitcherEntrySuggestion;
}): string => `${suggestion.targetType}:${suggestion.uid}`;

export const getBookmarkTargetKey = ({
  bookmark,
}: {
  bookmark: QuickSwitcherBookmark;
}): string => {
  const targetType = getBookmarkTargetType({ bookmark });
  const targetUid = getBookmarkTargetUid({ bookmark });
  return targetUid ? `${targetType}:${targetUid}` : `url:${bookmark.url}`;
};

export const getSavedTargetKeys = ({
  bookmarks,
}: {
  bookmarks: QuickSwitcherBookmark[];
}): Set<string> =>
  new Set(bookmarks.map((bookmark) => getBookmarkTargetKey({ bookmark })));

const toSuggestion = ({
  breadcrumbs,
  uid,
  title,
  targetType,
}: {
  breadcrumbs?: string[];
  uid: string;
  title: string;
  targetType: QuickSwitcherTargetType;
}): QuickSwitcherEntrySuggestion | null => {
  const url = buildRoamPageUrl({ pageUid: uid });
  if (!uid || !title || !url) {
    return null;
  }
  return {
    ...(breadcrumbs ? { breadcrumbs } : {}),
    uid,
    title,
    targetType,
    url,
  };
};

export const createBookmarkFromSuggestion = ({
  suggestion,
  id = createBookmarkId(),
}: {
  suggestion: QuickSwitcherEntrySuggestion;
  id?: string;
}): QuickSwitcherBookmark => ({
  id,
  title: suggestion.title,
  targetType: suggestion.targetType,
  pageUid: suggestion.targetType === "page" ? suggestion.uid : null,
  blockUid: suggestion.targetType === "block" ? suggestion.uid : null,
  url: suggestion.url,
  ...(suggestion.breadcrumbs ? { breadcrumbs: suggestion.breadcrumbs } : {}),
});

export const getBlockBreadcrumbsFromPull = ({
  block,
}: {
  block: PulledRoamBlock | null | undefined;
}): string[] => {
  if (!block) {
    return [];
  }

  const page = block[":block/page"];
  const pageTitle = isPulledRoamBlock(page)
    ? getPulledBlockLabel({ block: page })
    : "";
  const parents = Array.isArray(block[":block/parents"])
    ? block[":block/parents"].filter(isPulledRoamBlock)
    : [];
  const parentLabels = parents
    .slice()
    .reverse()
    .map((parent) => getPulledBlockLabel({ block: parent }))
    .filter(Boolean);

  return [...(pageTitle ? [pageTitle] : []), ...parentLabels].filter(
    (segment, index, segments) =>
      index === 0 || segment !== segments[index - 1],
  );
};

export const getBlockBreadcrumbs = async ({
  uid,
}: {
  uid: string;
}): Promise<string[]> => {
  try {
    const block = (await Promise.resolve(
      window.roamAlphaAPI.data.pull(
        `[
          {:block/page [:node/title]}
          {:block/parents [:node/title :block/string]}
        ]`,
        [":block/uid", uid],
      ),
    )) as PulledRoamBlock | null | undefined;
    return getBlockBreadcrumbsFromPull({ block });
  } catch (error) {
    return [];
  }
};

const addBreadcrumbsToBlockSuggestions = async ({
  suggestions,
}: {
  suggestions: QuickSwitcherEntrySuggestion[];
}): Promise<QuickSwitcherEntrySuggestion[]> => {
  const breadcrumbEntries = await Promise.all(
    suggestions
      .filter((suggestion) => suggestion.targetType === "block")
      .map(
        async (suggestion): Promise<[string, string[]]> => [
          suggestion.uid,
          await getBlockBreadcrumbs({ uid: suggestion.uid }),
        ],
      ),
  );
  const breadcrumbsByUid = new Map<string, string[]>(breadcrumbEntries);

  return suggestions.map((suggestion) => {
    const breadcrumbs = breadcrumbsByUid.get(suggestion.uid);
    if (!breadcrumbs) {
      return suggestion;
    }
    return {
      ...suggestion,
      breadcrumbs,
    };
  });
};

export const searchEntries = async ({
  query,
  savedTargetKeys,
  searchApi,
}: {
  query: string;
  savedTargetKeys: Set<string>;
  searchApi?: RoamSearchApi;
}): Promise<QuickSwitcherEntrySuggestion[]> => {
  const options: RoamSearchOptions = {
    "hide-code-blocks": false,
    limit: MAX_SEARCH_RESULTS,
    pull: SEARCH_RESULT_PULL,
    "search-blocks": true,
    "search-pages": true,
    "search-str": query.trim(),
  };
  const searchResults = searchApi
    ? await searchApi(options)
    : await (
        window.roamAlphaAPI.data
          .async as typeof window.roamAlphaAPI.data.async & {
          search: RoamSearchApi;
        }
      ).search(options);

  const seen = new Set<string>();
  const addSuggestion = ({
    suggestion,
    result,
  }: {
    suggestion: QuickSwitcherEntrySuggestion | null;
    result: QuickSwitcherEntrySuggestion[];
  }): boolean => {
    if (!suggestion) {
      return false;
    }
    const key = getSuggestionTargetKey({ suggestion });
    if (savedTargetKeys.has(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    result.push(suggestion);
    return true;
  };

  const suggestions: QuickSwitcherEntrySuggestion[] = [];
  let pageSuggestionCount = 0;
  let blockSuggestionCount = 0;

  searchResults.some((result) => {
    const uid = getSearchResultValue({ key: ":block/uid", result });
    const pageTitle = getSearchResultValue({ key: ":node/title", result });
    const blockText = getSearchResultValue({ key: ":block/string", result });
    const targetType = pageTitle ? "page" : "block";
    if (
      (targetType === "page" && pageSuggestionCount >= MAX_PAGE_SUGGESTIONS) ||
      (targetType === "block" && blockSuggestionCount >= MAX_BLOCK_SUGGESTIONS)
    ) {
      return false;
    }

    const suggestion = toSuggestion({
      uid,
      title: pageTitle || deriveBlockTitle({ text: blockText }),
      targetType,
    });
    if (addSuggestion({ suggestion, result: suggestions })) {
      if (targetType === "page") {
        pageSuggestionCount += 1;
      } else {
        blockSuggestionCount += 1;
      }
    }
    return (
      pageSuggestionCount >= MAX_PAGE_SUGGESTIONS &&
      blockSuggestionCount >= MAX_BLOCK_SUGGESTIONS
    );
  });

  return addBreadcrumbsToBlockSuggestions({ suggestions });
};

const resolveUidToSuggestion = async ({
  uid,
}: {
  uid: string;
}): Promise<QuickSwitcherEntrySuggestion | null> => {
  const datalogUid = toDatalogString({ value: uid });
  const pageRows = (await window.roamAlphaAPI.data.backend.q(
    `[:find ?title
      :where
      [?page :block/uid ${datalogUid}]
      [?page :node/title ?title]]`,
  )) as [string][];
  const pageTitle = pageRows[0]?.[0] || "";
  if (pageTitle) {
    return toSuggestion({
      uid,
      title: pageTitle,
      targetType: "page",
    });
  }

  const blockRows = (await window.roamAlphaAPI.data.backend.q(
    `[:find ?text
      :where
      [?block :block/uid ${datalogUid}]
      [?block :block/string ?text]]`,
  )) as [string][];
  const blockText = blockRows[0]?.[0] || "";
  if (!blockText && !blockRows.length) {
    return null;
  }
  return toSuggestion({
    breadcrumbs: await getBlockBreadcrumbs({ uid }),
    uid,
    title: deriveBlockTitle({ text: blockText }),
    targetType: "block",
  });
};

const resolvePageTitleToSuggestion = async ({
  title,
}: {
  title: string;
}): Promise<QuickSwitcherEntrySuggestion | null> => {
  const rows = (await window.roamAlphaAPI.data.backend.q(
    `[:find ?uid
      :where
      [?page :node/title ${toDatalogString({ value: title })}]
      [?page :block/uid ?uid]]`,
  )) as [string][];
  const pageUid = rows[0]?.[0] || "";
  if (!pageUid) {
    return null;
  }
  return toSuggestion({
    uid: pageUid,
    title,
    targetType: "page",
  });
};

export const resolveEntryInput = async ({
  value,
}: {
  value: string;
}): Promise<QuickSwitcherEntrySuggestion | null> => {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  const uid = getUidFromEntryInput({ value: normalizedValue });
  if (uid) {
    const suggestion = await resolveUidToSuggestion({ uid });
    if (suggestion) {
      return suggestion;
    }
  }

  return resolvePageTitleToSuggestion({ title: normalizedValue });
};
