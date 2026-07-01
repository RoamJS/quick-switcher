import {
  Button,
  FormGroup,
  InputGroup,
  Menu,
  MenuItem,
  Spinner,
  Tag,
} from "@blueprintjs/core";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { render as renderToast } from "roamjs-components/components/Toast";
import type {
  QuickSwitcherBookmark,
  QuickSwitcherTargetType,
} from "~/types/quickSwitcher";
import {
  buildRoamPageUrl,
  createBookmarkId,
  deriveBlockTitle,
  extractBlockRefUid,
  getBookmarkTargetLabel,
  getBookmarkTargetType,
  getBookmarkTargetUid,
  parsePageUidFromUrl,
} from "~/utils/quickSwitcher";

type QuickSwitcherSettingsDependencies = {
  initialBookmarks: QuickSwitcherBookmark[];
  onBookmarksChange: (bookmarks: QuickSwitcherBookmark[]) => void;
};

type EntrySuggestion = {
  uid: string;
  title: string;
  targetType: QuickSwitcherTargetType;
  url: string;
};

type ToastIntent = "none" | "primary" | "success" | "warning" | "danger";

const MAX_PAGE_SUGGESTIONS = 8;
const MAX_BLOCK_SUGGESTIONS = 8;

const showToast = ({
  content,
  intent = "none",
}: {
  content: string;
  intent?: ToastIntent;
}): void => {
  renderToast({
    id: `quick-switcher-settings-toast-${Date.now()}`,
    content,
    intent,
    timeout: 2200,
  });
};

const toDatalogString = ({ value }: { value: string }): string =>
  JSON.stringify(value);

const escapeRegex = ({ value }: { value: string }): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getSearchRegex = ({ query }: { query: string }): string =>
  `(?i)${escapeRegex({ value: query.trim() })}`;

const isPageUrlInput = ({ entry }: { entry: string }): boolean =>
  /^https?:\/\//i.test(entry) ||
  entry.startsWith("#/") ||
  entry.startsWith("/#/");

const getUidFromEntryInput = ({ value }: { value: string }): string => {
  const normalizedValue = value.trim();
  return (
    extractBlockRefUid({ value: normalizedValue }) ||
    (isPageUrlInput({ entry: normalizedValue })
      ? parsePageUidFromUrl({ url: normalizedValue })
      : normalizedValue) ||
    ""
  );
};

const getSuggestionTargetKey = ({
  suggestion,
}: {
  suggestion: EntrySuggestion;
}): string => `${suggestion.targetType}:${suggestion.uid}`;

const getBookmarkTargetKey = ({
  bookmark,
}: {
  bookmark: QuickSwitcherBookmark;
}): string => {
  const targetType = getBookmarkTargetType({ bookmark });
  const targetUid = getBookmarkTargetUid({ bookmark });
  return targetUid ? `${targetType}:${targetUid}` : `url:${bookmark.url}`;
};

const getSavedTargetKeys = ({
  bookmarks,
}: {
  bookmarks: QuickSwitcherBookmark[];
}): Set<string> =>
  new Set(bookmarks.map((bookmark) => getBookmarkTargetKey({ bookmark })));

const toSuggestion = ({
  uid,
  title,
  targetType,
}: {
  uid: string;
  title: string;
  targetType: QuickSwitcherTargetType;
}): EntrySuggestion | null => {
  const url = buildRoamPageUrl({ pageUid: uid });
  if (!uid || !title || !url) {
    return null;
  }
  return {
    uid,
    title,
    targetType,
    url,
  };
};

const searchEntries = async ({
  query,
  savedTargetKeys,
}: {
  query: string;
  savedTargetKeys: Set<string>;
}): Promise<EntrySuggestion[]> => {
  const regex = toDatalogString({ value: getSearchRegex({ query }) });
  const [pageRows, blockRows] = await Promise.all([
    window.roamAlphaAPI.data.backend.q(
      `[:find ?uid ?title
        :where
        [?page :node/title ?title]
        [?page :block/uid ?uid]
        [[re-pattern ${regex}] ?regex]
        [[re-find ?regex ?title]]]`,
    ) as Promise<[string, string][]>,
    window.roamAlphaAPI.data.backend.q(
      `[:find ?uid ?text
        :where
        [?block :block/string ?text]
        [?block :block/uid ?uid]
        [[re-pattern ${regex}] ?regex]
        [[re-find ?regex ?text]]]`,
    ) as Promise<[string, string][]>,
  ]);

  const seen = new Set<string>();
  const addSuggestion = ({
    suggestion,
    result,
  }: {
    suggestion: EntrySuggestion | null;
    result: EntrySuggestion[];
  }): boolean => {
    if (!suggestion) {
      return false;
    }
    const key = getSuggestionTargetKey({ suggestion });
    if (savedTargetKeys.has(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    result.push(suggestion);
    return true;
  };

  const pages = pageRows
    .map(([uid, title]) =>
      toSuggestion({
        uid,
        title,
        targetType: "page",
      }),
    )
    .sort((a, b) => (a?.title || "").localeCompare(b?.title || ""));
  const blocks = blockRows
    .map(([uid, text]) =>
      toSuggestion({
        uid,
        title: deriveBlockTitle({ text }),
        targetType: "block",
      }),
    )
    .sort((a, b) => (a?.title || "").localeCompare(b?.title || ""));

  const suggestions: EntrySuggestion[] = [];
  let pageSuggestionCount = 0;
  pages.some((suggestion) => {
    if (addSuggestion({ suggestion, result: suggestions })) {
      pageSuggestionCount += 1;
    }
    return pageSuggestionCount >= MAX_PAGE_SUGGESTIONS;
  });
  let blockSuggestionCount = 0;
  blocks.some((suggestion) => {
    if (addSuggestion({ suggestion, result: suggestions })) {
      blockSuggestionCount += 1;
    }
    return blockSuggestionCount >= MAX_BLOCK_SUGGESTIONS;
  });
  return suggestions;
};

const resolveUidToSuggestion = async ({
  uid,
}: {
  uid: string;
}): Promise<EntrySuggestion | null> => {
  const datalogUid = toDatalogString({ value: uid });
  const pageRows = (await window.roamAlphaAPI.data.backend.q(
    `[:find ?title
      :where
      [?page :block/uid ${datalogUid}]
      [?page :node/title ?title]]`,
  )) as [string][];
  const pageTitle = pageRows[0]?.[0] || "";
  if (pageTitle) {
    return toSuggestion({
      uid,
      title: pageTitle,
      targetType: "page",
    });
  }

  const blockRows = (await window.roamAlphaAPI.data.backend.q(
    `[:find ?text
      :where
      [?block :block/uid ${datalogUid}]
      [?block :block/string ?text]]`,
  )) as [string][];
  const blockText = blockRows[0]?.[0] || "";
  if (!blockText && !blockRows.length) {
    return null;
  }
  return toSuggestion({
    uid,
    title: deriveBlockTitle({ text: blockText }),
    targetType: "block",
  });
};

const resolvePageTitleToSuggestion = async ({
  title,
}: {
  title: string;
}): Promise<EntrySuggestion | null> => {
  const rows = (await window.roamAlphaAPI.data.backend.q(
    `[:find ?uid
      :where
      [?page :node/title ${toDatalogString({ value: title })}]
      [?page :block/uid ?uid]]`,
  )) as [string][];
  const pageUid = rows[0]?.[0] || "";
  if (!pageUid) {
    return null;
  }
  return toSuggestion({
    uid: pageUid,
    title,
    targetType: "page",
  });
};

const resolveEntryInput = async ({
  value,
}: {
  value: string;
}): Promise<EntrySuggestion | null> => {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  const uid = getUidFromEntryInput({ value: normalizedValue });
  if (uid) {
    const suggestion = await resolveUidToSuggestion({ uid });
    if (suggestion) {
      return suggestion;
    }
  }

  return resolvePageTitleToSuggestion({ title: normalizedValue });
};

export const createQuickSwitcherSettingsComponent = ({
  initialBookmarks,
  onBookmarksChange,
}: QuickSwitcherSettingsDependencies): React.FC => {
  const QuickSwitcherSettings = (): React.ReactElement => {
    const [bookmarks, setBookmarks] =
      useState<QuickSwitcherBookmark[]>(initialBookmarks);
    const [entryInput, setEntryInput] = useState("");
    const [suggestions, setSuggestions] = useState<EntrySuggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const searchRequestRef = useRef(0);

    const normalizedEntryInput = entryInput.trim();
    const savedTargetKeys = useMemo(
      () => getSavedTargetKeys({ bookmarks }),
      [bookmarks],
    );
    const shouldShowSuggestions =
      isInputFocused && (isSearching || suggestions.length > 0);

    useEffect((): void | (() => void) => {
      const query = entryInput.trim();
      const requestId = searchRequestRef.current + 1;
      searchRequestRef.current = requestId;
      setSelectedIndex(0);

      if (query.length < 2) {
        setSuggestions([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      const timeout = window.setTimeout(() => {
        void searchEntries({
          query,
          savedTargetKeys,
        })
          .then((nextSuggestions) => {
            if (searchRequestRef.current !== requestId) {
              return;
            }
            setSuggestions(nextSuggestions);
          })
          .catch(() => {
            if (searchRequestRef.current !== requestId) {
              return;
            }
            setSuggestions([]);
          })
          .finally(() => {
            if (searchRequestRef.current === requestId) {
              setIsSearching(false);
            }
          });
      }, 180);

      return () => window.clearTimeout(timeout);
    }, [entryInput, savedTargetKeys]);

    const setAndPersistBookmarks = useCallback(
      ({ nextBookmarks }: { nextBookmarks: QuickSwitcherBookmark[] }): void => {
        setBookmarks(nextBookmarks);
        onBookmarksChange(nextBookmarks);
      },
      [onBookmarksChange],
    );

    const clearEntryInput = useCallback((): void => {
      setEntryInput("");
      setSuggestions([]);
      setSelectedIndex(0);
      setIsSearching(false);
    }, []);

    const addSuggestion = useCallback(
      ({ suggestion }: { suggestion: EntrySuggestion }): boolean => {
        const key = getSuggestionTargetKey({ suggestion });
        if (savedTargetKeys.has(key)) {
          showToast({
            content: `"${suggestion.title}" is already saved`,
            intent: "warning",
          });
          return false;
        }

        const nextBookmarks = [
          ...bookmarks,
          {
            id: createBookmarkId(),
            title: suggestion.title,
            targetType: suggestion.targetType,
            pageUid: suggestion.targetType === "page" ? suggestion.uid : null,
            blockUid: suggestion.targetType === "block" ? suggestion.uid : null,
            url: suggestion.url,
          },
        ];

        setAndPersistBookmarks({ nextBookmarks });
        clearEntryInput();
        setIsInputFocused(false);
        showToast({
          content: `${suggestion.targetType === "page" ? "Page" : "Block"} added`,
          intent: "success",
        });
        return true;
      },
      [bookmarks, clearEntryInput, savedTargetKeys, setAndPersistBookmarks],
    );

    const addEntryFromInput = useCallback(async (): Promise<void> => {
      if (!normalizedEntryInput) {
        showToast({
          content: "Search for a page or block first",
          intent: "warning",
        });
        return;
      }

      setIsAdding(true);
      try {
        const suggestion = await resolveEntryInput({
          value: normalizedEntryInput,
        });
        if (!suggestion) {
          showToast({
            content: "No page or block matched that input",
            intent: "warning",
          });
          return;
        }
        addSuggestion({ suggestion });
      } catch (error) {
        showToast({
          content: "Unable to add that entry",
          intent: "danger",
        });
      } finally {
        setIsAdding(false);
      }
    }, [addSuggestion, normalizedEntryInput]);

    const removeBookmark = useCallback(
      ({ bookmark }: { bookmark: QuickSwitcherBookmark }): void => {
        setAndPersistBookmarks({
          nextBookmarks: bookmarks.filter((b) => b.id !== bookmark.id),
        });
      },
      [bookmarks, setAndPersistBookmarks],
    );

    const onInputKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === "ArrowDown") {
          if (!suggestions.length) {
            return;
          }
          event.preventDefault();
          setSelectedIndex((current) =>
            Math.min(current + 1, suggestions.length - 1),
          );
          return;
        }

        if (event.key === "ArrowUp") {
          if (!suggestions.length) {
            return;
          }
          event.preventDefault();
          setSelectedIndex((current) => Math.max(current - 1, 0));
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          const selectedSuggestion = suggestions[selectedIndex];
          if (selectedSuggestion) {
            addSuggestion({ suggestion: selectedSuggestion });
            return;
          }
          void addEntryFromInput();
          return;
        }

        if (event.key === "Escape") {
          setSuggestions([]);
          setIsInputFocused(false);
        }
      },
      [addEntryFromInput, addSuggestion, selectedIndex, suggestions],
    );

    return (
      <div className="flex flex-col gap-3">
        <FormGroup
          helperText="Search by page title, block text, UID, Roam URL, or block reference."
          label="Add page or block"
        >
          <div className="flex items-start gap-2">
            <div className="relative min-w-0 flex-1">
              <InputGroup
                autoComplete="off"
                leftIcon="search"
                onBlur={(): void => {
                  window.setTimeout(() => setIsInputFocused(false), 120);
                }}
                onChange={(
                  event: React.ChangeEvent<HTMLInputElement>,
                ): void => {
                  setEntryInput(event.target.value);
                  setIsInputFocused(true);
                }}
                onFocus={(): void => setIsInputFocused(true)}
                onKeyDown={onInputKeyDown}
                placeholder="Search pages, blocks, UIDs, or ((block refs))"
                rightElement={
                  isSearching ? (
                    <Spinner className="mr-2" size={16} />
                  ) : undefined
                }
                value={entryInput}
              />
              {shouldShowSuggestions ? (
                <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded border border-slate-200 bg-white shadow-lg">
                  {suggestions.length ? (
                    <Menu>
                      {suggestions.map((suggestion, index) => (
                        <MenuItem
                          active={selectedIndex === index}
                          icon={
                            suggestion.targetType === "page"
                              ? "document"
                              : "citation"
                          }
                          key={getSuggestionTargetKey({ suggestion })}
                          labelElement={
                            <Tag minimal>
                              {suggestion.targetType === "page"
                                ? "Page"
                                : "Block"}
                            </Tag>
                          }
                          multiline
                          onClick={(): void => {
                            addSuggestion({ suggestion });
                          }}
                          onMouseEnter={(): void => setSelectedIndex(index)}
                          text={
                            <div className="flex min-w-0 flex-col gap-1 py-1 pr-3">
                              <div className="truncate">{suggestion.title}</div>
                              <div className="truncate text-xs text-slate-500">
                                {suggestion.uid}
                              </div>
                            </div>
                          }
                        />
                      ))}
                    </Menu>
                  ) : (
                    <div className="bp3-text-muted px-3 py-2 text-sm">
                      Searching...
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <Button
              disabled={!normalizedEntryInput || isAdding}
              icon="plus"
              intent="primary"
              loading={isAdding}
              onClick={(): void => {
                void addEntryFromInput();
              }}
              text="Add"
            />
          </div>
        </FormGroup>

        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded border border-slate-200 p-2">
          {bookmarks.length ? (
            bookmarks.map((bookmark) => (
              <div
                className="flex min-h-[36px] items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-b-0"
                key={bookmark.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{bookmark.title}</div>
                  <div className="truncate text-xs text-slate-500">
                    {bookmark.url}
                  </div>
                </div>
                <Tag minimal>{getBookmarkTargetLabel({ bookmark })}</Tag>
                <Button
                  aria-label={`Delete ${bookmark.title}`}
                  icon="cross"
                  intent="danger"
                  minimal
                  onClick={(): void => removeBookmark({ bookmark })}
                  small
                />
              </div>
            ))
          ) : (
            <div className="bp3-text-muted text-sm">
              No saved entries configured yet.
            </div>
          )}
        </div>
      </div>
    );
  };

  return QuickSwitcherSettings;
};
