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

const MAX_PAGE_SUGGESTIONS = 8;
const MAX_BLOCK_SUGGESTIONS = 8;

const toDatalogString = ({ value }: { value: string }): string =>
  JSON.stringify(value);

const escapeRegex = ({ value }: { value: string }): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getSearchRegex = ({ query }: { query: string }): string =>
  `(?i)${escapeRegex({ value: query.trim() })}`;

const isPulledRoamBlock = (value: unknown): value is PulledRoamBlock =>
  typeof value === "object" && value !== null;

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
}: {
  query: string;
  savedTargetKeys: Set<string>;
}): Promise<QuickSwitcherEntrySuggestion[]> => {
  const regex = toDatalogString({ value: getSearchRegex({ query }) });
  const [pageRows, blockRows] = await Promise.all([
    window.roamAlphaAPI.data.backend.q(
      `[:find ?uid ?title
        :where
        [?page :node/title ?title]
        [?page :block/uid ?uid]
        [[re-pattern ${regex}] ?regex]
        [[re-find ?regex ?title]]]`,
    ) as Promise<[string, string][]>,
    window.roamAlphaAPI.data.backend.q(
      `[:find ?uid ?text
        :where
        [?block :block/string ?text]
        [?block :block/uid ?uid]
        [[re-pattern ${regex}] ?regex]
        [[re-find ?regex ?text]]]`,
    ) as Promise<[string, string][]>,
  ]);

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

  const pages = pageRows
    .map(([uid, title]) =>
      toSuggestion({
        uid,
        title,
        targetType: "page",
      }),
    )
    .sort((a, b) => (a?.title || "").localeCompare(b?.title || ""));
  const blocks = blockRows
    .map(([uid, text]) =>
      toSuggestion({
        uid,
        title: deriveBlockTitle({ text }),
        targetType: "block",
      }),
    )
    .sort((a, b) => (a?.title || "").localeCompare(b?.title || ""));

  const suggestions: QuickSwitcherEntrySuggestion[] = [];
  let pageSuggestionCount = 0;
  pages.some((suggestion) => {
    if (addSuggestion({ suggestion, result: suggestions })) {
      pageSuggestionCount += 1;
    }
    return pageSuggestionCount >= MAX_PAGE_SUGGESTIONS;
  });
  let blockSuggestionCount = 0;
  blocks.some((suggestion) => {
    if (addSuggestion({ suggestion, result: suggestions })) {
      blockSuggestionCount += 1;
    }
    return blockSuggestionCount >= MAX_BLOCK_SUGGESTIONS;
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
