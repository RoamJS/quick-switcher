import type {
  QuickSwitcherBookmark,
  QuickSwitcherCommandPaletteSettings,
  QuickSwitcherQuerySource,
  QuickSwitcherTargetType,
  ShortcutKeyboardEvent,
} from "~/types/quickSwitcher";

const MODIFIER_ORDER = ["ctrl", "meta", "alt", "shift"] as const;
const MODIFIER_SET = new Set<string>(MODIFIER_ORDER);
const MODIFIER_EVENT_KEYS = new Set(["control", "meta", "alt", "shift"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const BLOCK_REF_REGEX = /\(\(([A-Za-z0-9_-]+)\)\)/;
const QUERY_BLOCK_REGEX = /^\{\{query block(?::(.+?))?\}\}$/i;

const DEFAULT_QUERY_SOURCE: QuickSwitcherQuerySource = {
  enabled: false,
  queryRef: "",
};
const DEFAULT_COMMAND_PALETTE_PREFIX = "Q S - ";

const DEFAULT_COMMAND_PALETTE_SETTINGS: QuickSwitcherCommandPaletteSettings = {
  enabled: false,
  prefix: DEFAULT_COMMAND_PALETTE_PREFIX,
};

const normalizeModifierToken = ({ token }: { token: string }): string => {
  const normalizedToken = token.toLowerCase().trim();
  if (normalizedToken === "cmd" || normalizedToken === "command") {
    return "meta";
  }
  if (normalizedToken === "option") {
    return "alt";
  }
  if (normalizedToken === "super" || normalizedToken === "win") {
    return "meta";
  }
  return normalizedToken;
};

const normalizeKeyToken = ({ token }: { token: string }): string => {
  const lowerToken = token.toLowerCase();
  if (lowerToken === " " || lowerToken.trim() === "spacebar") {
    return "space";
  }
  const normalizedToken = lowerToken.trim();
  if (!normalizedToken) {
    return "";
  }
  if (normalizedToken === "space") {
    return "space";
  }
  if (normalizedToken === "esc") {
    return "escape";
  }
  return normalizedToken;
};

const sortAndJoinShortcutTokens = ({
  modifierTokens,
  keyToken,
}: {
  modifierTokens: Set<string>;
  keyToken: string;
}): string => {
  const orderedModifiers = MODIFIER_ORDER.filter((token) =>
    modifierTokens.has(token),
  );
  return [...orderedModifiers, keyToken].join("+");
};

export const normalizeShortcut = ({
  shortcut,
}: {
  shortcut: string;
}): string | null => {
  const rawTokens = shortcut
    .split(/[+-]/)
    .map((token) => normalizeModifierToken({ token }))
    .filter(Boolean);
  if (!rawTokens.length) {
    return null;
  }

  const modifierTokens = new Set<string>();
  let keyToken = "";

  rawTokens.forEach((token) => {
    const normalizedToken = normalizeKeyToken({ token });
    if (!normalizedToken) {
      return;
    }
    if (MODIFIER_SET.has(normalizedToken)) {
      modifierTokens.add(normalizedToken);
      return;
    }
    if (!keyToken) {
      keyToken = normalizedToken;
    }
  });

  if (!keyToken) {
    return null;
  }

  return sortAndJoinShortcutTokens({ modifierTokens, keyToken });
};

export const shortcutHasModifier = ({
  shortcut,
}: {
  shortcut: string;
}): boolean => {
  const normalizedShortcut = normalizeShortcut({ shortcut });
  if (!normalizedShortcut) {
    return false;
  }
  return normalizedShortcut.split("+").some((token) => MODIFIER_SET.has(token));
};

const normalizeKeyboardEventKey = ({ key }: { key: string }): string => {
  const normalizedKey = normalizeKeyToken({ token: key });
  if (normalizedKey.length === 1) {
    return normalizedKey;
  }
  if (normalizedKey.startsWith("arrow")) {
    return normalizedKey;
  }
  if (normalizedKey === "enter" || normalizedKey === "tab") {
    return normalizedKey;
  }
  if (normalizedKey === "backspace" || normalizedKey === "delete") {
    return normalizedKey;
  }
  return normalizedKey;
};

export const keyboardEventToShortcut = ({
  event,
}: {
  event: ShortcutKeyboardEvent;
}): string | null => {
  const keyToken = normalizeKeyboardEventKey({ key: event.key });
  if (!keyToken || MODIFIER_EVENT_KEYS.has(keyToken)) {
    return null;
  }

  const modifierTokens = new Set<string>();
  if (event.ctrlKey) {
    modifierTokens.add("ctrl");
  }
  if (event.metaKey) {
    modifierTokens.add("meta");
  }
  if (event.altKey) {
    modifierTokens.add("alt");
  }
  if (event.shiftKey) {
    modifierTokens.add("shift");
  }

  return sortAndJoinShortcutTokens({ modifierTokens, keyToken });
};

const labelShortcutToken = ({
  token,
  isMac,
}: {
  token: string;
  isMac: boolean;
}): string => {
  if (token === "ctrl") {
    return "Ctrl";
  }
  if (token === "meta") {
    return isMac ? "Cmd" : "Meta";
  }
  if (token === "alt") {
    return isMac ? "Opt" : "Alt";
  }
  if (token === "shift") {
    return "Shift";
  }
  if (token === "space") {
    return "Space";
  }
  if (token.startsWith("arrow")) {
    return token.replace("arrow", "Arrow ");
  }
  if (token.length === 1) {
    return token.toUpperCase();
  }
  return token[0].toUpperCase() + token.slice(1);
};

export const formatShortcutForDisplay = ({
  shortcut,
  isMac,
}: {
  shortcut: string;
  isMac: boolean;
}): string => {
  const normalizedShortcut = normalizeShortcut({ shortcut });
  if (!normalizedShortcut) {
    return "";
  }
  return normalizedShortcut
    .split("+")
    .map((token) => labelShortcutToken({ token, isMac }))
    .join(" + ");
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

export const getCurrentRoamGraphName = (): string | null => {
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

const getLastSegmentFromPath = ({ path }: { path: string }): string => {
  const segments = parsePathSegments({ path });
  if (!segments.length) {
    return "Untitled";
  }
  return decodeURIComponent(segments[segments.length - 1]);
};

export const derivePageTitleFromUrl = ({ url }: { url: string }): string => {
  const pageUid = parsePageUidFromUrl({ url });
  if (pageUid) {
    return pageUid;
  }
  const absoluteUrl = toAbsoluteUrl({ url });
  if (!absoluteUrl) {
    return "Untitled";
  }
  const parsedUrl = new URL(absoluteUrl);
  const hashPath = parseHashPath({ hash: parsedUrl.hash });
  if (hashPath) {
    return getLastSegmentFromPath({ path: hashPath });
  }
  return getLastSegmentFromPath({ path: parsedUrl.pathname });
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
    const normalizedTitle = bookmark.title.toLowerCase();
    const normalizedUrl = bookmark.url.toLowerCase();
    return (
      normalizedTitle.includes(normalizedQuery) ||
      normalizedUrl.includes(normalizedQuery)
    );
  });
};

export const moveBookmarkByOffset = ({
  bookmarks,
  index,
  offset,
}: {
  bookmarks: QuickSwitcherBookmark[];
  index: number;
  offset: number;
}): QuickSwitcherBookmark[] => {
  const nextIndex = index + offset;
  if (
    index < 0 ||
    nextIndex < 0 ||
    index >= bookmarks.length ||
    nextIndex >= bookmarks.length
  ) {
    return bookmarks;
  }

  const nextBookmarks = [...bookmarks];
  const [bookmark] = nextBookmarks.splice(index, 1);
  nextBookmarks.splice(nextIndex, 0, bookmark);
  return nextBookmarks;
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
  const shortcut =
    typeof value.shortcut === "string" ? value.shortcut.trim() : "";
  if (!url || !title) {
    return null;
  }

  const normalizedShortcut = shortcut ? normalizeShortcut({ shortcut }) : null;
  if (shortcut && !normalizedShortcut) {
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

  return {
    id,
    title,
    url,
    targetType,
    pageUid: resolvedPageUid || null,
    blockUid: resolvedBlockUid || null,
    shortcut: normalizedShortcut,
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

export const parseStoredQuerySource = ({
  value,
}: {
  value: unknown;
}): QuickSwitcherQuerySource => {
  if (!isRecord(value)) {
    return DEFAULT_QUERY_SOURCE;
  }

  const queryRef = typeof value.queryRef === "string" ? value.queryRef : "";
  return {
    enabled: Boolean(value.enabled),
    queryRef: queryRef.trim(),
  };
};

export const normalizeQuerySource = ({
  querySource,
}: {
  querySource: QuickSwitcherQuerySource;
}): QuickSwitcherQuerySource => ({
  enabled: Boolean(querySource.enabled),
  queryRef: querySource.queryRef.trim(),
});

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
      ? value.prefix
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
}): string => `${settings.prefix}${bookmark.title}`;

export const extractBlockRefUid = ({
  value,
}: {
  value: string;
}): string | null => {
  const match = value.match(BLOCK_REF_REGEX);
  return match?.[1] || null;
};

export const extractQueryBlockLabel = ({
  value,
}: {
  value: string;
}): string | null => {
  const match = value.trim().match(QUERY_BLOCK_REGEX);
  const label = match?.[1]?.trim();
  return label || null;
};

export const createBookmarkId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
