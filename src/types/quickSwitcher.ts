export type QuickSwitcherBookmark = {
  id: string;
  title: string;
  url: string;
  pageUid: string | null;
  shortcut: string | null;
};

export type ShortcutKeyboardEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};
