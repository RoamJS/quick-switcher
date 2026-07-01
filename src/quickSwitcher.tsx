import React from "react";
import ReactDOM from "react-dom";
import { render as renderToast } from "roamjs-components/components/Toast";
import getPageTitleByPageUid from "roamjs-components/queries/getPageTitleByPageUid";
import type { OnloadArgs } from "roamjs-components/types/native";
import type { Result as QueryBuilderResult } from "roamjs-components/types/query-builder";
import QuickSwitcherDialog from "~/components/QuickSwitcherDialog";
import type {
  QuickSwitcherBookmark,
  QuickSwitcherCommandPaletteSettings,
  QuickSwitcherQuerySource,
} from "~/types/quickSwitcher";
import {
  buildRoamPageUrl,
  getBookmarkTargetLabel,
  getBookmarkTargetType,
  getBookmarkTargetUid,
  getCommandPaletteCommandLabel,
  normalizeCommandPaletteSettings,
  normalizeQuerySource,
  parseStoredCommandPaletteSettings,
  parsePageUidFromUrl,
  parseStoredQuerySource,
  parseStoredBookmarks,
  resolveActiveQuerySourceUid,
  toAbsoluteUrl,
  type QueryBuilderSourceCandidate,
} from "~/utils/quickSwitcher";

const BOOKMARKS_SETTING_KEY = "quickSwitcherBookmarks";
const QUERY_SOURCE_SETTING_KEY = "quickSwitcherQuerySource";
const COMMAND_PALETTE_SETTING_KEY = "quickSwitcherCommandPalette";
export const QUERY_SOURCE_REF_SETTING_KEY = "quickSwitcherQuerySourceRef";
export const COMMAND_PALETTE_ENABLED_SETTING_KEY =
  "quickSwitcherCommandPaletteEnabled";
export const COMMAND_PALETTE_PREFIX_SETTING_KEY =
  "quickSwitcherCommandPalettePrefix";
const OPEN_QUICK_SWITCHER_COMMAND = "Quick Switcher: Open";

type ExtensionApi = OnloadArgs["extensionAPI"];

type ToastIntent = "none" | "primary" | "success" | "warning" | "danger";

export type QuickSwitcherController = {
  getBookmarks: () => QuickSwitcherBookmark[];
  getCommandPaletteSettings: () => QuickSwitcherCommandPaletteSettings;
  getQuerySource: () => QuickSwitcherQuerySource;
  open: () => void;
  setBookmarks: (bookmarks: QuickSwitcherBookmark[]) => void;
  setCommandPaletteSettings: (
    settings: QuickSwitcherCommandPaletteSettings,
  ) => void;
  setQuerySource: (querySource: QuickSwitcherQuerySource) => void;
  unload: () => void;
};

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

const sanitizeBookmarks = ({
  bookmarks,
}: {
  bookmarks: QuickSwitcherBookmark[];
}): QuickSwitcherBookmark[] => {
  const seenTargets = new Set<string>();

  return bookmarks.reduce<QuickSwitcherBookmark[]>((result, bookmark) => {
    const normalizedUrl = toAbsoluteUrl({ url: bookmark.url });
    if (!normalizedUrl) {
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
    if (seenTargets.has(targetKey)) {
      return result;
    }

    seenTargets.add(targetKey);

    result.push({
      ...bookmark,
      url: normalizedUrl,
      targetType,
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

const getUniqueCommandLabel = ({
  bookmark,
  settings,
  usedLabels,
}: {
  bookmark: QuickSwitcherBookmark;
  settings: QuickSwitcherCommandPaletteSettings;
  usedLabels: Set<string>;
}): string => {
  const baseLabel = getCommandPaletteCommandLabel({ bookmark, settings });
  if (!usedLabels.has(baseLabel)) {
    return baseLabel;
  }

  const typedLabel = `${baseLabel} (${getBookmarkTargetLabel({ bookmark })})`;
  if (!usedLabels.has(typedLabel)) {
    return typedLabel;
  }

  let index = 2;
  while (usedLabels.has(`${typedLabel} ${index}`)) {
    index += 1;
  }
  return `${typedLabel} ${index}`;
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
  listActiveQueries: () => { uid: string }[];
} | null => {
  const queryBuilder = (
    window as Window & {
      roamjs?: {
        extension?: {
          queryBuilder?: {
            runQuery?: (parentUid: string) => Promise<QueryBuilderResult[]>;
            listActiveQueries?: () => { uid: string }[];
          };
        };
      };
    }
  ).roamjs?.extension?.queryBuilder;
  return queryBuilder?.runQuery && queryBuilder.listActiveQueries
    ? {
        runQuery: queryBuilder.runQuery,
        listActiveQueries: queryBuilder.listActiveQueries,
      }
    : null;
};

const getActiveQueryUids = ({
  queryBuilder,
}: {
  queryBuilder: { listActiveQueries: () => { uid: string }[] };
}): string[] => {
  try {
    return [
      ...new Set(
        queryBuilder
          .listActiveQueries()
          .map((query) => query.uid)
          .filter(Boolean),
      ),
    ];
  } catch (error) {
    return [];
  }
};

const resolveActiveQueryMetadata = async ({
  uid,
}: {
  uid: string;
}): Promise<QueryBuilderSourceCandidate> => {
  const pulled = (await window.roamAlphaAPI.data.async.pull(
    "[:block/uid :block/string :node/title]",
    [":block/uid", uid],
  )) as {
    ":block/uid"?: string;
    ":block/string"?: string;
    ":node/title"?: string;
  } | null;
  return {
    uid: pulled?.[":block/uid"] || uid,
    title: pulled?.[":node/title"] || "",
    text: pulled?.[":block/string"] || "",
  };
};

const resolveQueryBuilderUid = async ({
  queryRef,
  queryBuilder,
}: {
  queryRef: string;
  queryBuilder: { listActiveQueries: () => { uid: string }[] };
}): Promise<string> => {
  const activeQueryUids = getActiveQueryUids({ queryBuilder });
  if (!activeQueryUids.length) {
    return "";
  }

  const uidOnlyMatch = resolveActiveQuerySourceUid({
    queryRef,
    activeQueries: activeQueryUids.map((uid) => ({ uid })),
  });
  if (uidOnlyMatch) {
    return uidOnlyMatch;
  }

  const activeQueries = await Promise.all(
    activeQueryUids.map((uid) =>
      resolveActiveQueryMetadata({ uid }).catch(() => ({ uid })),
    ),
  );
  return (
    resolveActiveQuerySourceUid({
      queryRef,
      activeQueries,
    }) || ""
  );
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

  const queryUid = await resolveQueryBuilderUid({
    queryRef: querySource.queryRef,
    queryBuilder,
  });
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
      source: "query-builder",
    });
    return bookmarks;
  }, []);
};

const getBooleanSetting = ({
  value,
  fallback,
}: {
  value: unknown;
  fallback: boolean;
}): boolean => (typeof value === "boolean" ? value : fallback);

const getStringSetting = ({
  value,
  fallback,
}: {
  value: unknown;
  fallback: string;
}): string => (typeof value === "string" ? value : fallback);

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
  const storedCommandPaletteSettings = parseStoredCommandPaletteSettings({
    value: extensionAPI.settings.get(COMMAND_PALETTE_SETTING_KEY),
  });
  let commandPaletteSettings = normalizeCommandPaletteSettings({
    settings: {
      enabled: getBooleanSetting({
        value: extensionAPI.settings.get(COMMAND_PALETTE_ENABLED_SETTING_KEY),
        fallback: storedCommandPaletteSettings.enabled,
      }),
      prefix: getStringSetting({
        value: extensionAPI.settings.get(COMMAND_PALETTE_PREFIX_SETTING_KEY),
        fallback: storedCommandPaletteSettings.prefix,
      }),
    },
  });
  const storedQuerySource = parseStoredQuerySource({
    value: extensionAPI.settings.get(QUERY_SOURCE_SETTING_KEY),
  });
  let querySource = normalizeQuerySource({
    querySource: {
      enabled: storedQuerySource.enabled,
      queryRef: getStringSetting({
        value: extensionAPI.settings.get(QUERY_SOURCE_REF_SETTING_KEY),
        fallback: storedQuerySource.queryRef,
      }),
    },
  });
  let dynamicBookmarks: QuickSwitcherBookmark[] = [];
  let registeredBookmarkCommandLabels = new Set<string>();
  let bookmarkCommandSyncQueue = Promise.resolve();
  let bookmarkCommandSyncId = 0;
  let isDialogOpen = false;
  let hasRenderedDialog = false;
  let isUnloaded = false;
  let refreshQuerySourceId = 0;

  const persistBookmarks = (): void => {
    void extensionAPI.settings.set(BOOKMARKS_SETTING_KEY, bookmarks);
  };

  const persistCommandPaletteSettings = (): void => {
    void extensionAPI.settings.set(
      COMMAND_PALETTE_SETTING_KEY,
      commandPaletteSettings,
    );
    void extensionAPI.settings.set(
      COMMAND_PALETTE_ENABLED_SETTING_KEY,
      commandPaletteSettings.enabled,
    );
    void extensionAPI.settings.set(
      COMMAND_PALETTE_PREFIX_SETTING_KEY,
      commandPaletteSettings.prefix,
    );
  };

  const persistQuerySource = (): void => {
    void extensionAPI.settings.set(QUERY_SOURCE_SETTING_KEY, querySource);
    void extensionAPI.settings.set(
      QUERY_SOURCE_REF_SETTING_KEY,
      querySource.queryRef,
    );
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

  const syncBookmarkCommands = (): void => {
    const syncId = bookmarkCommandSyncId + 1;
    bookmarkCommandSyncId = syncId;
    bookmarkCommandSyncQueue = bookmarkCommandSyncQueue
      .then(async () => {
        const labelsToRemove = [...registeredBookmarkCommandLabels];
        registeredBookmarkCommandLabels = new Set();
        await Promise.all(
          labelsToRemove.map((label) =>
            extensionAPI.ui.commandPalette
              .removeCommand({ label })
              .catch(() => undefined),
          ),
        );

        if (
          isUnloaded ||
          syncId !== bookmarkCommandSyncId ||
          !commandPaletteSettings.enabled
        ) {
          return;
        }

        const usedLabels = new Set<string>([OPEN_QUICK_SWITCHER_COMMAND]);
        const nextLabels = bookmarks.map((bookmark) => {
          const label = getUniqueCommandLabel({
            bookmark,
            settings: commandPaletteSettings,
            usedLabels,
          });
          usedLabels.add(label);
          return { bookmark, label };
        });

        await Promise.all(
          nextLabels.map(({ bookmark, label }) =>
            extensionAPI.ui.commandPalette
              .addCommand({
                label,
                callback: () => {
                  void openBookmark({ bookmark });
                },
              })
              .catch(() => undefined),
          ),
        );

        if (isUnloaded || syncId !== bookmarkCommandSyncId) {
          await Promise.all(
            nextLabels.map(({ label }) =>
              extensionAPI.ui.commandPalette
                .removeCommand({ label })
                .catch(() => undefined),
            ),
          );
          return;
        }

        registeredBookmarkCommandLabels = new Set(
          nextLabels.map(({ label }) => label),
        );
      })
      .catch(() => undefined);
  };

  registerCommand();
  syncBookmarkCommands();

  return {
    getBookmarks: (): QuickSwitcherBookmark[] => bookmarks,
    getCommandPaletteSettings: (): QuickSwitcherCommandPaletteSettings =>
      commandPaletteSettings,
    getQuerySource: (): QuickSwitcherQuerySource => querySource,
    open: openDialog,
    setBookmarks: (nextBookmarks: QuickSwitcherBookmark[]): void => {
      bookmarks = sanitizeBookmarks({ bookmarks: nextBookmarks });
      persistBookmarks();
      syncBookmarkCommands();
      if (hasRenderedDialog) {
        render();
      }
    },
    setCommandPaletteSettings: (
      nextCommandPaletteSettings: QuickSwitcherCommandPaletteSettings,
    ): void => {
      commandPaletteSettings = normalizeCommandPaletteSettings({
        settings: nextCommandPaletteSettings,
      });
      persistCommandPaletteSettings();
      syncBookmarkCommands();
    },
    setQuerySource: (nextQuerySource: QuickSwitcherQuerySource): void => {
      querySource = normalizeQuerySource({ querySource: nextQuerySource });
      persistQuerySource();
      void refreshQuerySourceBookmarks();
    },
    unload: (): void => {
      isUnloaded = true;
      refreshQuerySourceId += 1;
      bookmarkCommandSyncId += 1;
      closeDialog();
      syncBookmarkCommands();
      unregisterCommand();
      ReactDOM.unmountComponentAtNode(root);
      root.remove();
    },
  };
};

export default initializeQuickSwitcher;
