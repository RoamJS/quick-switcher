export type QuickSwitcherBookmark = {
  id: string;
  title: string;
  url: string;
  pageUid: string | null;
  shortcut: string | null;
  source?: "saved" | "query-builder";
};

export type QuickSwitcherQuerySource = {
  enabled: boolean;
  queryRef: string;
};

export type ShortcutKeyboardEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};
