import React from "react";
import ReactDOM from "react-dom";
import { render as renderToast } from "roamjs-components/components/Toast";
import type { OnloadArgs } from "roamjs-components/types/native";
import QuickSwitcherDialog from "~/components/QuickSwitcherDialog";
import type {
  QuickSwitcherBookmark,
  QuickSwitcherCommandPaletteSettings,
  QuickSwitcherDialogMode,
} from "~/types/quickSwitcher";
import {
  getBookmarkTargetLabel,
  getBookmarkTargetType,
  getBookmarkTargetUid,
  getCommandPaletteCommandLabel,
  normalizeCommandPaletteSettings,
  parseStoredCommandPaletteSettings,
  parsePageUidFromUrl,
  parseStoredBookmarks,
  toAbsoluteUrl,
} from "~/utils/quickSwitcher";

const BOOKMARKS_SETTING_KEY = "quickSwitcherBookmarks";
const COMMAND_PALETTE_SETTING_KEY = "quickSwitcherCommandPalette";
export const COMMAND_PALETTE_ENABLED_SETTING_KEY =
  "quickSwitcherCommandPaletteEnabled";
export const COMMAND_PALETTE_PREFIX_SETTING_KEY =
  "quickSwitcherCommandPalettePrefix";
const OPEN_QUICK_SWITCHER_COMMAND = "Quick Switcher: Open";

type ExtensionApi = OnloadArgs["extensionAPI"];

type ToastIntent = "none" | "primary" | "success" | "warning" | "danger";

type QuickSwitcherController = {
  getBookmarks: () => QuickSwitcherBookmark[];
  getCommandPaletteSettings: () => QuickSwitcherCommandPaletteSettings;
  open: ({ mode }?: { mode?: QuickSwitcherDialogMode }) => void;
  setBookmarks: (bookmarks: QuickSwitcherBookmark[]) => void;
  setCommandPaletteSettings: (
    settings: QuickSwitcherCommandPaletteSettings,
  ) => void;
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

const openBookmarkInSidebar = async ({
  bookmark,
}: {
  bookmark: QuickSwitcherBookmark;
}): Promise<boolean> => {
  const targetType = getBookmarkTargetType({ bookmark });
  const targetUid = getBookmarkTargetUid({ bookmark });
  if (!targetUid) {
    showToast({
      content: `Unable to open ${bookmark.title} in sidebar`,
      intent: "danger",
    });
    return false;
  }

  try {
    if (targetType === "block") {
      await window.roamAlphaAPI.ui.rightSidebar.addWindow({
        window: {
          type: "block",
          "block-uid": targetUid,
        },
      });
    } else {
      await window.roamAlphaAPI.ui.rightSidebar.addWindow({
        window: {
          type: "outline",
          "page-uid": targetUid,
        },
      });
    }
    return true;
  } catch (error) {
    showToast({
      content: `Unable to open ${bookmark.title} in sidebar`,
      intent: "danger",
    });
    return false;
  }
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
  let registeredBookmarkCommandLabels = new Set<string>();
  let bookmarkCommandSyncQueue = Promise.resolve();
  let bookmarkCommandSyncId = 0;
  let isDialogOpen = false;
  let dialogMode: QuickSwitcherDialogMode = "open";
  let hasRenderedDialog = false;
  let isUnloaded = false;

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

  const closeDialog = (): void => {
    isDialogOpen = false;
    if (hasRenderedDialog) {
      render();
    }
  };

  const setBookmarks = (nextBookmarks: QuickSwitcherBookmark[]): void => {
    bookmarks = sanitizeBookmarks({ bookmarks: nextBookmarks });
    persistBookmarks();
    syncBookmarkCommands();
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
        bookmarks={bookmarks}
        initialMode={dialogMode}
        isOpen={isDialogOpen}
        onClose={closeDialog}
        onBookmarksChange={setBookmarks}
        onOpenBookmark={(bookmark): void => {
          void openBookmark({ bookmark }).then((didOpen) => {
            if (didOpen) {
              closeDialog();
            }
          });
        }}
        onOpenBookmarkInSidebar={(bookmark): void => {
          void openBookmarkInSidebar({ bookmark }).then((didOpen) => {
            if (didOpen) {
              closeDialog();
            }
          });
        }}
      />,
      root,
    );
  };

  const openDialog = ({
    mode = "open",
  }: {
    mode?: QuickSwitcherDialogMode;
  } = {}): void => {
    dialogMode = mode;
    isDialogOpen = true;
    render();
  };

  const registerCommand = (): void => {
    void extensionAPI.ui.commandPalette
      .addCommand({
        label: OPEN_QUICK_SWITCHER_COMMAND,
        callback: () => openDialog(),
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
    open: openDialog,
    setBookmarks,
    setCommandPaletteSettings: (
      nextCommandPaletteSettings: QuickSwitcherCommandPaletteSettings,
    ): void => {
      commandPaletteSettings = normalizeCommandPaletteSettings({
        settings: nextCommandPaletteSettings,
      });
      persistCommandPaletteSettings();
      syncBookmarkCommands();
    },
    unload: (): void => {
      isUnloaded = true;
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
