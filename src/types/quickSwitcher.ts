export type QuickSwitcherTargetType = "page" | "block";

export type QuickSwitcherDialogMode = "open" | "manage";

export type QuickSwitcherBookmark = {
  id: string;
  title: string;
  alias?: string;
  url: string;
  targetType: QuickSwitcherTargetType;
  pageUid: string | null;
  blockUid: string | null;
  breadcrumbs?: string[];
};

export type QuickSwitcherCommandPaletteSettings = {
  enabled: boolean;
  prefix: string;
};
