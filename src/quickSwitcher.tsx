import React from "react";
import ReactDOM from "react-dom";
import { render as renderToast } from "roamjs-components/components/Toast";
import getPageTitleByPageUid from "roamjs-components/queries/getPageTitleByPageUid";
import getPageUidByPageTitle from "roamjs-components/queries/getPageUidByPageTitle";
import type { OnloadArgs } from "roamjs-components/types/native";
import type { Result as QueryBuilderResult } from "roamjs-components/types/query-builder";
import QuickSwitcherDialog from "~/components/QuickSwitcherDialog";
import type {
  QuickSwitcherBookmark,
  QuickSwitcherQuerySource,
} from "~/types/quickSwitcher";
import {
  buildRoamPageUrl,
  extractBlockRefUid,
  extractQueryBlockLabel,
  getBookmarkTargetType,
  getBookmarkTargetUid,
  keyboardEventToShortcut,
  normalizeQuerySource,
  normalizeShortcut,
  parsePageUidFromUrl,
  parseStoredQuerySource,
  parseStoredBookmarks,
  toAbsoluteUrl,
} from "~/utils/quickSwitcher";

const BOOKMARKS_SETTING_KEY = "quickSwitcherBookmarks";
const QUERY_SOURCE_SETTING_KEY = "quickSwitcherQuerySource";
const OPEN_QUICK_SWITCHER_COMMAND = "Quick Switcher: Open";

type ExtensionApi = OnloadArgs["extensionAPI"];

type ToastIntent = "none" | "primary" | "success" | "warning" | "danger";

export type QuickSwitcherController = {
  getBookmarks: () => QuickSwitcherBookmark[];
  getQuerySource: () => QuickSwitcherQuerySource;
  open: () => void;
  setBookmarks: (bookmarks: QuickSwitcherBookmark[]) => void;
  setQuerySource: (querySource: QuickSwitcherQuerySource) => void;
  unload: () => void;
};

const isMacOs = (): boolean =>
  /mac|iphone|ipad|ipod/i.test(
    typeof navigator === "undefined"
      ? ""
      : `${navigator.platform} ${navigator.userAgent}`,
  );

const showToast = ({
  content,
  intent = "none",
}: {
  content: string;
  intent?: ToastIntent;
}): void => {
  renderToast({
    id: `quick-switcher-toast-${Date.now()}`,
    content,
    intent,
    timeout: 1800,
  });
};

const isEditableTarget = ({
  target,
}: {
  target: EventTarget | null;
}): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(
    target.closest("[contenteditable='true'], .rm-block-input, .cm-content"),
  );
};

const sanitizeBookmarks = ({
  bookmarks,
}: {
  bookmarks: QuickSwitcherBookmark[];
}): QuickSwitcherBookmark[] => {
  const seenShortcuts = new Set<string>();
  const seenTargets = new Set<string>();

  return bookmarks.reduce<QuickSwitcherBookmark[]>((result, bookmark) => {
    const normalizedShortcut = bookmark.shortcut
      ? normalizeShortcut({
          shortcut: bookmark.shortcut,
        })
      : null;
    const normalizedUrl = toAbsoluteUrl({ url: bookmark.url });
    if (!normalizedUrl || (bookmark.shortcut && !normalizedShortcut)) {
      return result;
    }
    const targetType = getBookmarkTargetType({ bookmark });
    const parsedUrlUid = parsePageUidFromUrl({ url: normalizedUrl });
    const pageUid =
      targetType === "page"
        ? bookmark.pageUid || parsedUrlUid
        : bookmark.pageUid || null;
    const blockUid =
      targetType === "block"
        ? bookmark.blockUid || parsedUrlUid
        : bookmark.blockUid || null;
    if (targetType === "block" && !blockUid) {
      return result;
    }
    const targetKey =
      targetType === "block" && blockUid
        ? `block:${blockUid}`
        : pageUid
          ? `page:${pageUid}`
          : `url:${normalizedUrl}`;
    if (
      (normalizedShortcut && seenShortcuts.has(normalizedShortcut)) ||
      seenTargets.has(targetKey)
    ) {
      return result;
    }

    if (normalizedShortcut) {
      seenShortcuts.add(normalizedShortcut);
    }
    seenTargets.add(targetKey);

    result.push({
      ...bookmark,
      url: normalizedUrl,
      targetType,
      shortcut: normalizedShortcut,
      pageUid,
      blockUid,
    });
    return result;
  }, []);
};

const openBookmark = async ({
  bookmark,
}: {
  bookmark: QuickSwitcherBookmark;
}): Promise<boolean> => {
  const targetType = getBookmarkTargetType({ bookmark });
  const targetUid = getBookmarkTargetUid({ bookmark });
  try {
    if (targetType === "block" && targetUid) {
      await window.roamAlphaAPI.ui.mainWindow.openBlock({
        block: { uid: targetUid },
      });
      return true;
    }
    if (targetUid) {
      await window.roamAlphaAPI.ui.mainWindow.openPage({
        page: { uid: targetUid },
      });
      return true;
    }
    window.location.assign(bookmark.url);
    return true;
  } catch (error) {
    showToast({
      content: `Unable to open ${bookmark.title}`,
      intent: "danger",
    });
    return false;
  }
};

const getBookmarkKey = ({ bookmark }: { bookmark: QuickSwitcherBookmark }) => {
  const targetType = getBookmarkTargetType({ bookmark });
  const targetUid = getBookmarkTargetUid({ bookmark });
  return targetUid ? `${targetType}:${targetUid}` : `url:${bookmark.url}`;
};

const mergeBookmarks = ({
  savedBookmarks,
  dynamicBookmarks,
}: {
  savedBookmarks: QuickSwitcherBookmark[];
  dynamicBookmarks: QuickSwitcherBookmark[];
}): QuickSwitcherBookmark[] => {
  const seen = new Set<string>();
  return [...savedBookmarks, ...dynamicBookmarks].filter((bookmark) => {
    const key = getBookmarkKey({ bookmark });
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const getQueryBuilderApi = (): {
  runQuery: (parentUid: string) => Promise<QueryBuilderResult[]>;
} | null => {
  const queryBuilder = (
    window as Window & {
      roamjs?: {
        extension?: {
          queryBuilder?: {
            runQuery?: (parentUid: string) => Promise<QueryBuilderResult[]>;
          };
        };
      };
    }
  ).roamjs?.extension?.queryBuilder;
  return queryBuilder?.runQuery ? { runQuery: queryBuilder.runQuery } : null;
};

const getUidIfExists = ({ uid }: { uid: string }): string => {
  if (!uid) {
    return "";
  }
  const pulled = window.roamAlphaAPI.pull("[:block/uid]", [
    ":block/uid",
    uid,
  ]) as { ":block/uid"?: string } | null;
  return pulled?.[":block/uid"] || "";
};

const toDatalogString = ({ value }: { value: string }): string =>
  JSON.stringify(value);

const findQueryBlockUidByLabel = ({ label }: { label: string }): string => {
  const normalizedLabel = label.trim();
  if (!normalizedLabel) {
    return "";
  }

  const queryBlockReference = `{{query block:${normalizedLabel}}}`;
  return (
    (
      window.roamAlphaAPI.data.fast.q(
        `[:find ?uid :where
          [?b :block/uid ?uid]
          [?b :block/string ?s]
          [(clojure.string/includes? ?s ${toDatalogString({
            value: queryBlockReference,
          })})]]`,
      ) as string[][]
    )[0]?.[0] || ""
  );
};

const resolveQueryBuilderUid = ({ queryRef }: { queryRef: string }): string => {
  const normalizedQueryRef = queryRef.trim();
  if (!normalizedQueryRef) {
    return "";
  }

  const blockRefUid = extractBlockRefUid({ value: normalizedQueryRef });
  if (blockRefUid) {
    return getUidIfExists({ uid: blockRefUid });
  }

  const existingUid = getUidIfExists({ uid: normalizedQueryRef });
  if (existingUid) {
    return existingUid;
  }

  const queryBlockLabel = extractQueryBlockLabel({
    value: normalizedQueryRef,
  });
  if (queryBlockLabel) {
    return findQueryBlockUidByLabel({ label: queryBlockLabel });
  }

  const pageUid = getPageUidByPageTitle(normalizedQueryRef);
  if (pageUid) {
    return pageUid;
  }

  const defaultQueryPageUid = getPageUidByPageTitle(
    `queries/${normalizedQueryRef}`,
  );
  if (defaultQueryPageUid) {
    return defaultQueryPageUid;
  }

  return findQueryBlockUidByLabel({ label: normalizedQueryRef });
};

const getResultUidCandidates = ({
  result,
}: {
  result: QueryBuilderResult;
}): string[] => {
  const candidates = new Set<string>();
  Object.entries(result).forEach(([key, value]) => {
    if (typeof value !== "string") {
      return;
    }
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "uid" || normalizedKey.endsWith("-uid")) {
      candidates.add(value);
    }
  });
  return [...candidates];
};

const resolveQueryBuilderPageBookmarks = async ({
  querySource,
}: {
  querySource: QuickSwitcherQuerySource;
}): Promise<QuickSwitcherBookmark[]> => {
  if (!querySource.enabled || !querySource.queryRef) {
    return [];
  }

  const queryBuilder = getQueryBuilderApi();
  if (!queryBuilder) {
    return [];
  }

  const queryUid = resolveQueryBuilderUid({ queryRef: querySource.queryRef });
  if (!queryUid) {
    return [];
  }

  const results = await queryBuilder.runQuery(queryUid);
  const seenPageUids = new Set<string>();
  return results.reduce<QuickSwitcherBookmark[]>((bookmarks, result) => {
    const pageUid = getResultUidCandidates({ result }).find((uid) => {
      if (seenPageUids.has(uid)) {
        return false;
      }
      return Boolean(getPageTitleByPageUid(uid));
    });
    if (!pageUid) {
      return bookmarks;
    }

    const title = getPageTitleByPageUid(pageUid);
    const url = buildRoamPageUrl({ pageUid });
    if (!title || !url) {
      return bookmarks;
    }

    seenPageUids.add(pageUid);
    bookmarks.push({
      id: `query-builder-${pageUid}`,
      title,
      targetType: "page",
      pageUid,
      blockUid: null,
      url,
      shortcut: null,
      source: "query-builder",
    });
    return bookmarks;
  }, []);
};

const initializeQuickSwitcher = ({
  extensionAPI,
}: {
  extensionAPI: ExtensionApi;
}): QuickSwitcherController => {
  const root = document.createElement("div");
  root.id = "roamjs-quick-switcher-root";
  document.body.appendChild(root);

  let bookmarks = sanitizeBookmarks({
    bookmarks: parseStoredBookmarks({
      value: extensionAPI.settings.get(BOOKMARKS_SETTING_KEY),
    }),
  });
  let querySource = parseStoredQuerySource({
    value: extensionAPI.settings.get(QUERY_SOURCE_SETTING_KEY),
  });
  let dynamicBookmarks: QuickSwitcherBookmark[] = [];
  let isDialogOpen = false;
  let hasRenderedDialog = false;
  let isUnloaded = false;
  let refreshQuerySourceId = 0;

  const persistBookmarks = (): void => {
    void extensionAPI.settings.set(BOOKMARKS_SETTING_KEY, bookmarks);
  };

  const persistQuerySource = (): void => {
    void extensionAPI.settings.set(QUERY_SOURCE_SETTING_KEY, querySource);
  };

  const getMergedBookmarks = (): QuickSwitcherBookmark[] =>
    mergeBookmarks({
      savedBookmarks: bookmarks,
      dynamicBookmarks,
    });

  const closeDialog = (): void => {
    isDialogOpen = false;
    if (hasRenderedDialog) {
      render();
    }
  };

  const render = (): void => {
    if (isUnloaded) {
      return;
    }
    hasRenderedDialog = true;
    ReactDOM.render(
      <QuickSwitcherDialog
        bookmarks={getMergedBookmarks()}
        isMac={isMacOs()}
        isOpen={isDialogOpen}
        onClose={closeDialog}
        onOpenBookmark={(bookmark): void => {
          void openBookmark({ bookmark }).then((didOpen) => {
            if (didOpen) {
              closeDialog();
            }
          });
        }}
      />,
      root,
    );
  };

  const refreshQuerySourceBookmarks = async (): Promise<void> => {
    const refreshId = refreshQuerySourceId + 1;
    refreshQuerySourceId = refreshId;
    if (dynamicBookmarks.length) {
      dynamicBookmarks = [];
      if (hasRenderedDialog) {
        render();
      }
    }
    try {
      const nextDynamicBookmarks = await resolveQueryBuilderPageBookmarks({
        querySource,
      });
      if (refreshId !== refreshQuerySourceId || isUnloaded) {
        return;
      }
      dynamicBookmarks = nextDynamicBookmarks;
      if (hasRenderedDialog) {
        render();
      }
    } catch (error) {
      if (refreshId !== refreshQuerySourceId || isUnloaded) {
        return;
      }
      dynamicBookmarks = [];
      if (hasRenderedDialog) {
        render();
      }
      showToast({
        content: "Unable to load Query Builder pages",
        intent: "warning",
      });
    }
  };

  const openDialog = (): void => {
    isDialogOpen = true;
    dynamicBookmarks = [];
    render();
    void refreshQuerySourceBookmarks();
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (isDialogOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
      return;
    }

    if (isEditableTarget({ target: event.target })) {
      return;
    }

    const shortcut = keyboardEventToShortcut({ event });
    if (!shortcut) {
      return;
    }

    const bookmark = bookmarks.find((entry) => entry.shortcut === shortcut);
    if (!bookmark) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void openBookmark({ bookmark });
  };

  const registerCommand = (): void => {
    void extensionAPI.ui.commandPalette
      .addCommand({
        label: OPEN_QUICK_SWITCHER_COMMAND,
        callback: openDialog,
      })
      .catch(() => undefined);
  };

  const unregisterCommand = (): void => {
    void extensionAPI.ui.commandPalette
      .removeCommand({
        label: OPEN_QUICK_SWITCHER_COMMAND,
      })
      .catch(() => undefined);
  };

  document.addEventListener("keydown", onDocumentKeyDown, true);
  registerCommand();

  return {
    getBookmarks: (): QuickSwitcherBookmark[] => bookmarks,
    getQuerySource: (): QuickSwitcherQuerySource => querySource,
    open: openDialog,
    setBookmarks: (nextBookmarks: QuickSwitcherBookmark[]): void => {
      bookmarks = sanitizeBookmarks({ bookmarks: nextBookmarks });
      persistBookmarks();
      if (hasRenderedDialog) {
        render();
      }
    },
    setQuerySource: (nextQuerySource: QuickSwitcherQuerySource): void => {
      querySource = normalizeQuerySource({ querySource: nextQuerySource });
      persistQuerySource();
      void refreshQuerySourceBookmarks();
    },
    unload: (): void => {
      isUnloaded = true;
      refreshQuerySourceId += 1;
      closeDialog();
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      unregisterCommand();
      ReactDOM.unmountComponentAtNode(root);
      root.remove();
    },
  };
};

export default initializeQuickSwitcher;
