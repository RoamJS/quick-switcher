export type QuickSwitcherTargetType = "page" | "block";

export type QuickSwitcherBookmark = {
  id: string;
  title: string;
  url: string;
  targetType: QuickSwitcherTargetType;
  pageUid: string | null;
  blockUid: string | null;
  source?: "saved" | "query-builder";
};

export type QuickSwitcherQuerySource = {
  enabled: boolean;
  queryRef: string;
};

export type QuickSwitcherCommandPaletteSettings = {
  enabled: boolean;
  prefix: string;
};
