import React from "react";
import ReactDOM from "react-dom";
import { render as renderToast } from "roamjs-components/components/Toast";
import type { OnloadArgs } from "roamjs-components/types/native";
import QuickSwitcherDialog from "~/components/QuickSwitcherDialog";
import type { QuickSwitcherBookmark } from "~/types/quickSwitcher";
import {
  keyboardEventToShortcut,
  normalizeShortcut,
  parsePageUidFromUrl,
  parseStoredBookmarks,
  toAbsoluteUrl,
} from "~/utils/quickSwitcher";

const BOOKMARKS_SETTING_KEY = "quickSwitcherBookmarks";
const OPEN_QUICK_SWITCHER_COMMAND = "Quick Switcher: Open";

type ExtensionApi = OnloadArgs["extensionAPI"];

type ToastIntent = "none" | "primary" | "success" | "warning" | "danger";

export type QuickSwitcherController = {
  getBookmarks: () => QuickSwitcherBookmark[];
  open: () => void;
  setBookmarks: (bookmarks: QuickSwitcherBookmark[]) => void;
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
  const seenUrls = new Set<string>();

  return bookmarks.reduce<QuickSwitcherBookmark[]>((result, bookmark) => {
    const normalizedShortcut = normalizeShortcut({
      shortcut: bookmark.shortcut,
    });
    const normalizedUrl = toAbsoluteUrl({ url: bookmark.url });
    if (!normalizedShortcut || !normalizedUrl) {
      return result;
    }
    if (seenShortcuts.has(normalizedShortcut) || seenUrls.has(normalizedUrl)) {
      return result;
    }

    seenShortcuts.add(normalizedShortcut);
    seenUrls.add(normalizedUrl);

    result.push({
      ...bookmark,
      url: normalizedUrl,
      shortcut: normalizedShortcut,
      pageUid: bookmark.pageUid || parsePageUidFromUrl({ url: normalizedUrl }),
    });
    return result;
  }, []);
};

const openBookmark = async ({
  bookmark,
}: {
  bookmark: QuickSwitcherBookmark;
}): Promise<boolean> => {
  const pageUid =
    bookmark.pageUid || parsePageUidFromUrl({ url: bookmark.url });
  try {
    if (pageUid) {
      await window.roamAlphaAPI.ui.mainWindow.openPage({
        page: { uid: pageUid },
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
  let isDialogOpen = false;

  const persistBookmarks = (): void => {
    void extensionAPI.settings.set(BOOKMARKS_SETTING_KEY, bookmarks);
  };

  const closeDialog = (): void => {
    isDialogOpen = false;
    render();
  };

  const render = (): void => {
    ReactDOM.render(
      <QuickSwitcherDialog
        bookmarks={bookmarks}
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

  const openDialog = (): void => {
    isDialogOpen = true;
    render();
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (isDialogOpen && event.key === "Escape") {
      event.preventDefault();
      closeDialog();
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

  persistBookmarks();
  document.addEventListener("keydown", onDocumentKeyDown, true);
  registerCommand();
  render();

  return {
    getBookmarks: (): QuickSwitcherBookmark[] => bookmarks,
    open: openDialog,
    setBookmarks: (nextBookmarks: QuickSwitcherBookmark[]): void => {
      bookmarks = sanitizeBookmarks({ bookmarks: nextBookmarks });
      persistBookmarks();
      render();
    },
    unload: (): void => {
      closeDialog();
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      unregisterCommand();
      ReactDOM.unmountComponentAtNode(root);
      root.remove();
    },
  };
};

export default initializeQuickSwitcher;
