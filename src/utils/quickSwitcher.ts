import type {
  QuickSwitcherBookmark,
  QuickSwitcherCommandPaletteSettings,
  QuickSwitcherTargetType,
} from "~/types/quickSwitcher";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const BLOCK_REF_REGEX = /\(\(([A-Za-z0-9_-]+)\)\)/;
export const DEFAULT_COMMAND_PALETTE_PREFIX = "QS: ";
const LEGACY_COMMAND_PALETTE_PREFIX = "Q S - ";

const DEFAULT_COMMAND_PALETTE_SETTINGS: QuickSwitcherCommandPaletteSettings = {
  enabled: false,
  prefix: DEFAULT_COMMAND_PALETTE_PREFIX,
};

const getBaseOrigin = (): string => {
  if (typeof window === "undefined") {
    return "https://roamresearch.com";
  }
  return window.location.origin;
};

export const toAbsoluteUrl = ({ url }: { url: string }): string | null => {
  try {
    return new URL(url, getBaseOrigin()).toString();
  } catch (error) {
    return null;
  }
};

const parseHashPath = ({ hash }: { hash: string }): string => {
  if (!hash.startsWith("#")) {
    return hash;
  }
  return hash.slice(1).split("?")[0];
};

const parsePathSegments = ({ path }: { path: string }): string[] =>
  path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

const parsePathForPageUid = ({ path }: { path: string }): string | null => {
  const segments = parsePathSegments({ path });
  const pageIndex = segments.lastIndexOf("page");
  if (pageIndex === -1 || !segments[pageIndex + 1]) {
    return null;
  }
  return decodeURIComponent(segments[pageIndex + 1]);
};

const parsePathForGraphName = ({ path }: { path: string }): string | null => {
  const segments = parsePathSegments({ path });
  const appIndex = segments.lastIndexOf("app");
  if (appIndex === -1 || !segments[appIndex + 1]) {
    return null;
  }
  return decodeURIComponent(segments[appIndex + 1]);
};

export const parsePageUidFromUrl = ({
  url,
}: {
  url: string;
}): string | null => {
  const absoluteUrl = toAbsoluteUrl({ url });
  if (!absoluteUrl) {
    return null;
  }
  const parsedUrl = new URL(absoluteUrl);
  const fromHash = parsePathForPageUid({
    path: parseHashPath({ hash: parsedUrl.hash }),
  });
  if (fromHash) {
    return fromHash;
  }
  return parsePathForPageUid({ path: parsedUrl.pathname });
};

const getCurrentRoamGraphName = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const currentUrl = toAbsoluteUrl({ url: window.location.href });
  if (currentUrl) {
    const parsedUrl = new URL(currentUrl);
    const graphFromHash = parsePathForGraphName({
      path: parseHashPath({ hash: parsedUrl.hash }),
    });
    if (graphFromHash) {
      return graphFromHash;
    }
    const graphFromPath = parsePathForGraphName({ path: parsedUrl.pathname });
    if (graphFromPath) {
      return graphFromPath;
    }
  }

  const graphName = (
    window as Window & { roamAlphaAPI?: { graph?: { name?: string } } }
  ).roamAlphaAPI?.graph?.name;
  return typeof graphName === "string" && graphName.trim() ? graphName : null;
};

export const buildRoamPageUrl = ({
  pageUid,
  graphName,
}: {
  pageUid: string;
  graphName?: string | null;
}): string | null => {
  const normalizedPageUid = pageUid.trim();
  if (!normalizedPageUid) {
    return null;
  }
  const resolvedGraphName = graphName || getCurrentRoamGraphName();
  if (!resolvedGraphName) {
    return null;
  }
  const origin = getBaseOrigin();
  return `${origin}/#/app/${encodeURIComponent(resolvedGraphName)}/page/${encodeURIComponent(normalizedPageUid)}`;
};

export const getBookmarkTargetType = ({
  bookmark,
}: {
  bookmark: QuickSwitcherBookmark;
}): QuickSwitcherTargetType =>
  bookmark.targetType === "block" || bookmark.blockUid ? "block" : "page";

export const getBookmarkTargetUid = ({
  bookmark,
}: {
  bookmark: QuickSwitcherBookmark;
}): string | null => {
  const targetType = getBookmarkTargetType({ bookmark });
  if (targetType === "block") {
    return bookmark.blockUid || parsePageUidFromUrl({ url: bookmark.url });
  }
  return bookmark.pageUid || parsePageUidFromUrl({ url: bookmark.url });
};

export const getBookmarkTargetLabel = ({
  bookmark,
}: {
  bookmark: QuickSwitcherBookmark;
}): string =>
  getBookmarkTargetType({ bookmark }) === "block" ? "Block" : "Page";

export const deriveBlockTitle = ({
  text,
  maxWords = 8,
}: {
  text: string;
  maxWords?: number;
}): string => {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return "Untitled block";
  }
  const words = normalizedText.split(" ");
  if (words.length <= maxWords) {
    return normalizedText;
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
};

export const filterBookmarks = ({
  bookmarks,
  query,
}: {
  bookmarks: QuickSwitcherBookmark[];
  query: string;
}): QuickSwitcherBookmark[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return bookmarks;
  }
  return bookmarks.filter((bookmark) => {
    const normalizedAlias = (bookmark.alias || "").toLowerCase();
    const normalizedTitle = bookmark.title.toLowerCase();
    const normalizedUrl = bookmark.url.toLowerCase();
    return (
      normalizedAlias.includes(normalizedQuery) ||
      normalizedTitle.includes(normalizedQuery) ||
      normalizedUrl.includes(normalizedQuery)
    );
  });
};

const parseStoredBookmark = ({
  value,
  index,
}: {
  value: unknown;
  index: number;
}): QuickSwitcherBookmark | null => {
  if (!isRecord(value)) {
    return null;
  }

  const url = typeof value.url === "string" ? value.url.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!url || !title) {
    return null;
  }

  const pageUid = typeof value.pageUid === "string" ? value.pageUid.trim() : "";
  const blockUid =
    typeof value.blockUid === "string" ? value.blockUid.trim() : "";
  const parsedUrlUid = parsePageUidFromUrl({ url });
  const targetType =
    value.targetType === "block" || blockUid ? "block" : "page";
  const resolvedPageUid =
    targetType === "page" ? pageUid || parsedUrlUid : pageUid;
  const resolvedBlockUid =
    targetType === "block" ? blockUid || parsedUrlUid || pageUid : blockUid;
  if (targetType === "block" && !resolvedBlockUid) {
    return null;
  }
  const id =
    typeof value.id === "string" && value.id.trim()
      ? value.id
      : `${url}-${index}`;
  const alias =
    typeof value.alias === "string" && value.alias.trim()
      ? value.alias.replace(/\s+/g, " ").trim()
      : undefined;
  const breadcrumbs = Array.isArray(value.breadcrumbs)
    ? value.breadcrumbs
        .filter((segment): segment is string => typeof segment === "string")
        .map((segment) => segment.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    : undefined;

  return {
    id,
    title,
    ...(alias ? { alias } : {}),
    url,
    targetType,
    pageUid: resolvedPageUid || null,
    blockUid: resolvedBlockUid || null,
    ...(breadcrumbs ? { breadcrumbs } : {}),
  };
};

export const parseStoredBookmarks = ({
  value,
}: {
  value: unknown;
}): QuickSwitcherBookmark[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((bookmark, index) => parseStoredBookmark({ value: bookmark, index }))
    .filter((bookmark): bookmark is QuickSwitcherBookmark => Boolean(bookmark));
};

export const parseStoredCommandPaletteSettings = ({
  value,
}: {
  value: unknown;
}): QuickSwitcherCommandPaletteSettings => {
  if (!isRecord(value)) {
    return DEFAULT_COMMAND_PALETTE_SETTINGS;
  }

  const prefix =
    typeof value.prefix === "string" && value.prefix.trim()
      ? value.prefix === LEGACY_COMMAND_PALETTE_PREFIX
        ? DEFAULT_COMMAND_PALETTE_PREFIX
        : value.prefix
      : DEFAULT_COMMAND_PALETTE_PREFIX;
  return {
    enabled: Boolean(value.enabled),
    prefix,
  };
};

export const normalizeCommandPaletteSettings = ({
  settings,
}: {
  settings: QuickSwitcherCommandPaletteSettings;
}): QuickSwitcherCommandPaletteSettings => ({
  enabled: Boolean(settings.enabled),
  prefix: settings.prefix.trim()
    ? settings.prefix
    : DEFAULT_COMMAND_PALETTE_PREFIX,
});

export const getCommandPaletteCommandLabel = ({
  bookmark,
  settings,
}: {
  bookmark: QuickSwitcherBookmark;
  settings: QuickSwitcherCommandPaletteSettings;
}): string =>
  `${settings.prefix}${
    bookmark.alias ? `${bookmark.alias} (${bookmark.title})` : bookmark.title
  }`;

export const extractBlockRefUid = ({
  value,
}: {
  value: string;
}): string | null => {
  const match = value.match(BLOCK_REF_REGEX);
  return match?.[1] || null;
};

export const createBookmarkId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
