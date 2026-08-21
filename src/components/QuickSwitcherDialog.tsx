import {
  Button,
  Dialog,
  Divider,
  Icon,
  InputGroup,
  Menu,
  MenuItem,
  Spinner,
  Tooltip,
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
  QuickSwitcherDialogMode,
} from "~/types/quickSwitcher";
import {
  filterBookmarks,
  getBookmarkRowPresentation,
  getBookmarkTargetLabel,
  getBookmarkTargetType,
  getBookmarkTargetUid,
} from "~/utils/quickSwitcher";
import {
  createBookmarkFromSuggestion,
  getBlockBreadcrumbs,
  getSavedTargetKeys,
  getSuggestionTargetKey,
  resolveEntryInput,
  searchEntries,
  type QuickSwitcherEntrySuggestion,
} from "~/utils/quickSwitcherEntries";

type QuickSwitcherDialogProps = {
  isOpen: boolean;
  initialMode: QuickSwitcherDialogMode;
  bookmarks: QuickSwitcherBookmark[];
  onBookmarksChange: (bookmarks: QuickSwitcherBookmark[]) => void;
  onClose: () => void;
  onOpenBookmark: (bookmark: QuickSwitcherBookmark) => void;
  onOpenBookmarkInSidebar: (bookmark: QuickSwitcherBookmark) => void;
};

type ToastIntent = "none" | "primary" | "success" | "warning" | "danger";

type ModeOption = {
  icon: "document-open" | "edit";
  label: string;
  mode: QuickSwitcherDialogMode;
};

type FooterActionContentProps = {
  label: string;
  hotkeys?: string[];
  showEnter?: boolean;
};

type FooterActionButtonProps = FooterActionContentProps & {
  disabled?: boolean;
  onClick: () => void;
};

const MODE_OPTIONS: ModeOption[] = [
  {
    icon: "document-open",
    label: "Open",
    mode: "open",
  },
  {
    icon: "edit",
    label: "Manage",
    mode: "manage",
  },
];

const SEARCH_INPUT_STYLE: React.CSSProperties = {
  background: "transparent",
  boxShadow: "none",
};

const MENU_ITEM_STYLE: React.CSSProperties = {
  minHeight: 34,
};

const SELECTED_MENU_ITEM_STYLE: React.CSSProperties = {
  ...MENU_ITEM_STYLE,
  backgroundColor: "rgba(115, 134, 148, 0.3)",
  color: "#182026",
};

const FOOTER_STYLE: React.CSSProperties = {
  minHeight: 30,
};

const FOOTER_ACTION_CONTENT_STYLE: React.CSSProperties = {
  alignItems: "center",
  display: "inline-flex",
  flexWrap: "nowrap",
  whiteSpace: "nowrap",
};

const MODE_TABS_STYLE: React.CSSProperties = {
  alignItems: "stretch",
  display: "flex",
  gap: 12,
  padding: "0 16px",
};

const MODE_TAB_STYLE: React.CSSProperties = {
  backgroundColor: "transparent",
  borderBottomColor: "transparent",
  borderBottomStyle: "solid",
  borderBottomWidth: 3,
  borderRadius: 0,
  boxSizing: "border-box",
  color: "#182026",
  fontSize: 16,
  marginBottom: -1,
  minHeight: 48,
  padding: "0 24px",
};

const ACTIVE_MODE_TAB_STYLE: React.CSSProperties = {
  ...MODE_TAB_STYLE,
  borderBottomColor: "#137cbd",
  color: "#106ba3",
};

const showToast = ({
  content,
  intent = "none",
}: {
  content: string;
  intent?: ToastIntent;
}): void => {
  renderToast({
    id: `quick-switcher-dialog-toast-${Date.now()}`,
    content,
    intent,
    timeout: 2200,
  });
};

const getModeFromTabId = ({
  tabId,
}: {
  tabId: string | number;
}): QuickSwitcherDialogMode => (tabId === "manage" ? "manage" : "open");

const renderFooterActionContent = ({
  label,
  hotkeys = [],
  showEnter = false,
}: FooterActionContentProps): React.ReactElement => (
  <span style={FOOTER_ACTION_CONTENT_STYLE}>
    <span className="rm-find-or-create-footer__action-desc">{label}</span>
    {hotkeys.length ? (
      <span className="rm-find-or-create-footer__action-hotkey">
        {hotkeys.map((hotkey) => (
          <span
            className="rm-find-or-create-footer__action-hotkey-icon"
            key={hotkey}
          >
            {hotkey}
          </span>
        ))}
        {showEnter ? (
          <Icon
            className="rm-find-or-create-footer__action-hotkey-icon"
            icon="key-enter"
            size={9}
          />
        ) : null}
      </span>
    ) : showEnter ? (
      <Icon
        className="rm-find-or-create-footer__action-hotkey-icon"
        icon="key-enter"
        size={9}
      />
    ) : null}
  </span>
);

const FooterActionButton = ({
  disabled = false,
  hotkeys,
  label,
  onClick,
  showEnter,
}: FooterActionButtonProps): React.ReactElement => (
  <Button
    className="rm-find-or-create-footer__action"
    disabled={disabled}
    minimal
    onClick={onClick}
    type="button"
  >
    {renderFooterActionContent({ hotkeys, label, showEnter })}
  </Button>
);

const QuickSwitcherDialog = ({
  isOpen,
  initialMode,
  bookmarks,
  onBookmarksChange,
  onClose,
  onOpenBookmark,
  onOpenBookmarkInSidebar,
}: QuickSwitcherDialogProps): React.ReactElement => {
  const [mode, setMode] = useState<QuickSwitcherDialogMode>(initialMode);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entryInput, setEntryInput] = useState("");
  const [suggestions, setSuggestions] = useState<
    QuickSwitcherEntrySuggestion[]
  >([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingAliasBookmarkId, setEditingAliasBookmarkId] = useState<
    string | null
  >(null);
  const [aliasInput, setAliasInput] = useState("");
  const openInputRef = useRef<HTMLInputElement | null>(null);
  const manageInputRef = useRef<HTMLInputElement | null>(null);
  const searchRequestRef = useRef(0);

  const normalizedEntryInput = entryInput.trim();
  const visibleBookmarks = useMemo(
    () =>
      filterBookmarks({
        bookmarks,
        query,
      }),
    [bookmarks, query],
  );
  const savedTargetKeys = useMemo(
    () => getSavedTargetKeys({ bookmarks }),
    [bookmarks],
  );
  const shouldShowSuggestions = normalizedEntryInput.length >= 2;

  useEffect((): void | (() => void) => {
    if (!isOpen) {
      return;
    }

    const blockBookmarks = bookmarks
      .map((bookmark) => ({
        bookmark,
        targetType: getBookmarkTargetType({ bookmark }),
        targetUid: getBookmarkTargetUid({ bookmark }),
      }))
      .filter(
        ({ bookmark, targetType, targetUid }) =>
          targetType === "block" && Boolean(targetUid) && !bookmark.breadcrumbs,
      );
    if (!blockBookmarks.length) {
      return;
    }

    let isCanceled = false;
    void Promise.all(
      blockBookmarks.map(
        async ({ bookmark, targetUid }): Promise<[string, string[]]> => [
          bookmark.id,
          targetUid ? await getBlockBreadcrumbs({ uid: targetUid }) : [],
        ],
      ),
    ).then((breadcrumbEntries) => {
      if (isCanceled) {
        return;
      }

      const breadcrumbsById = new Map<string, string[]>(breadcrumbEntries);
      onBookmarksChange(
        bookmarks.map((bookmark) =>
          breadcrumbsById.has(bookmark.id)
            ? {
                ...bookmark,
                breadcrumbs: breadcrumbsById.get(bookmark.id) || [],
              }
            : bookmark,
        ),
      );
    });

    return () => {
      isCanceled = true;
    };
  }, [bookmarks, isOpen, onBookmarksChange]);

  const focusModeInput = useCallback(
    ({ nextMode }: { nextMode: QuickSwitcherDialogMode }): void => {
      const activeInput =
        nextMode === "manage" ? manageInputRef.current : openInputRef.current;
      activeInput?.focus();
    },
    [],
  );

  useEffect((): void | (() => void) => {
    if (!isOpen) {
      setQuery("");
      setEntryInput("");
      setSuggestions([]);
      setSelectedIndex(0);
      setSelectedSuggestionIndex(0);
      setIsSearching(false);
      setEditingAliasBookmarkId(null);
      setAliasInput("");
      setMode(initialMode);
      return;
    }
    setMode(initialMode);
    const timeout = window.setTimeout(() => {
      focusModeInput({ nextMode: initialMode });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [focusModeInput, initialMode, isOpen]);

  useEffect((): void => {
    if (selectedIndex < visibleBookmarks.length) {
      return;
    }
    setSelectedIndex(
      visibleBookmarks.length > 0 ? visibleBookmarks.length - 1 : 0,
    );
  }, [selectedIndex, visibleBookmarks.length]);

  useEffect((): void => {
    if (selectedSuggestionIndex < suggestions.length) {
      return;
    }
    setSelectedSuggestionIndex(
      suggestions.length > 0 ? suggestions.length - 1 : 0,
    );
  }, [selectedSuggestionIndex, suggestions.length]);

  useEffect((): void | (() => void) => {
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSuggestions([]);
    setSelectedSuggestionIndex(0);

    if (mode !== "manage" || normalizedEntryInput.length < 2) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timeout = window.setTimeout(() => {
      void searchEntries({
        query: normalizedEntryInput,
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
  }, [mode, normalizedEntryInput, savedTargetKeys]);

  const onModeChange = useCallback(
    (tabId: string | number): void => {
      const nextMode = getModeFromTabId({ tabId });
      setMode(nextMode);
      window.setTimeout(() => focusModeInput({ nextMode }), 0);
    },
    [focusModeInput],
  );

  const clearEntryInput = useCallback((): void => {
    searchRequestRef.current += 1;
    setEntryInput("");
    setSuggestions([]);
    setSelectedSuggestionIndex(0);
    setIsSearching(false);
  }, []);

  const onManageEntryInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      searchRequestRef.current += 1;
      setEntryInput(event.target.value);
      setSuggestions([]);
      setSelectedSuggestionIndex(0);
    },
    [],
  );

  const addSuggestion = useCallback(
    ({ suggestion }: { suggestion: QuickSwitcherEntrySuggestion }): boolean => {
      const key = getSuggestionTargetKey({ suggestion });
      if (savedTargetKeys.has(key)) {
        showToast({
          content: `"${suggestion.title}" is already saved`,
          intent: "warning",
        });
        return false;
      }

      onBookmarksChange([
        ...bookmarks,
        createBookmarkFromSuggestion({ suggestion }),
      ]);
      clearEntryInput();
      showToast({
        content: `${suggestion.targetType === "page" ? "Page" : "Block"} added`,
        intent: "success",
      });
      return true;
    },
    [bookmarks, clearEntryInput, onBookmarksChange, savedTargetKeys],
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
      onBookmarksChange(bookmarks.filter((b) => b.id !== bookmark.id));
      showToast({
        content: "Saved entry removed",
        intent: "success",
      });
    },
    [bookmarks, onBookmarksChange],
  );

  const startAliasEdit = useCallback(
    ({ bookmark }: { bookmark: QuickSwitcherBookmark }): void => {
      setEditingAliasBookmarkId(bookmark.id);
      setAliasInput(bookmark.alias || "");
    },
    [],
  );

  const cancelAliasEdit = useCallback((): void => {
    setEditingAliasBookmarkId(null);
    setAliasInput("");
  }, []);

  const saveAliasEdit = useCallback(
    ({ bookmark }: { bookmark: QuickSwitcherBookmark }): void => {
      const alias = aliasInput.replace(/\s+/g, " ").trim();
      onBookmarksChange(
        bookmarks.map((currentBookmark) => {
          if (currentBookmark.id !== bookmark.id) {
            return currentBookmark;
          }
          const { alias: _alias, ...bookmarkWithoutAlias } = currentBookmark;
          return alias
            ? {
                ...bookmarkWithoutAlias,
                alias,
              }
            : bookmarkWithoutAlias;
        }),
      );
      setEditingAliasBookmarkId(null);
      setAliasInput("");
      showToast({
        content: alias ? "Alias saved" : "Alias removed",
        intent: "success",
      });
    },
    [aliasInput, bookmarks, onBookmarksChange],
  );

  const onAliasInputKeyDown = useCallback(
    ({
      bookmark,
      event,
    }: {
      bookmark: QuickSwitcherBookmark;
      event: React.KeyboardEvent<HTMLInputElement>;
    }): void => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        saveAliasEdit({ bookmark });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelAliasEdit();
      }
    },
    [cancelAliasEdit, saveAliasEdit],
  );

  const openSelectedBookmark = useCallback((): void => {
    const bookmark = visibleBookmarks[selectedIndex];
    if (bookmark) {
      onOpenBookmark(bookmark);
    }
  }, [onOpenBookmark, selectedIndex, visibleBookmarks]);

  const openSelectedBookmarkInSidebar = useCallback((): void => {
    const bookmark = visibleBookmarks[selectedIndex];
    if (bookmark) {
      onOpenBookmarkInSidebar(bookmark);
    }
  }, [onOpenBookmarkInSidebar, selectedIndex, visibleBookmarks]);

  const onBookmarkRowClick = useCallback(
    ({
      bookmark,
      event,
    }: {
      bookmark: QuickSwitcherBookmark;
      event: React.MouseEvent<HTMLElement>;
    }): void => {
      if (event.shiftKey) {
        onOpenBookmarkInSidebar(bookmark);
        return;
      }
      onOpenBookmark(bookmark);
    },
    [onOpenBookmark, onOpenBookmarkInSidebar],
  );

  const addSelectedSuggestion = useCallback((): void => {
    const selectedSuggestion = suggestions[selectedSuggestionIndex];
    if (selectedSuggestion) {
      addSuggestion({ suggestion: selectedSuggestion });
      return;
    }
    void addEntryFromInput();
  }, [addEntryFromInput, addSuggestion, selectedSuggestionIndex, suggestions]);

  const onOpenInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "ArrowDown") {
        if (!visibleBookmarks.length) {
          return;
        }
        event.preventDefault();
        setSelectedIndex((current) =>
          Math.min(current + 1, visibleBookmarks.length - 1),
        );
        return;
      }

      if (event.key === "ArrowUp") {
        if (!visibleBookmarks.length) {
          return;
        }
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === "Enter") {
        if (!visibleBookmarks.length) {
          return;
        }
        event.preventDefault();
        if (event.shiftKey) {
          openSelectedBookmarkInSidebar();
          return;
        }
        openSelectedBookmark();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    },
    [
      onClose,
      openSelectedBookmark,
      openSelectedBookmarkInSidebar,
      visibleBookmarks.length,
    ],
  );

  const onManageInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "ArrowDown") {
        if (!suggestions.length) {
          return;
        }
        event.preventDefault();
        setSelectedSuggestionIndex((current) =>
          Math.min(current + 1, suggestions.length - 1),
        );
        return;
      }

      if (event.key === "ArrowUp") {
        if (!suggestions.length) {
          return;
        }
        event.preventDefault();
        setSelectedSuggestionIndex((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        addSelectedSuggestion();
        return;
      }

      if (event.key === "Escape") {
        if (entryInput || suggestions.length) {
          event.preventDefault();
          event.stopPropagation();
          clearEntryInput();
          return;
        }
        event.preventDefault();
        onClose();
      }
    },
    [
      addSelectedSuggestion,
      clearEntryInput,
      entryInput,
      onClose,
      suggestions.length,
    ],
  );

  const renderModeChip = ({
    option,
  }: {
    option: ModeOption;
  }): React.ReactElement => {
    const isActive = mode === option.mode;
    return (
      <Button
        aria-selected={isActive}
        icon={option.icon}
        minimal
        onClick={(): void => onModeChange(option.mode)}
        role="tab"
        style={isActive ? ACTIVE_MODE_TAB_STYLE : MODE_TAB_STYLE}
        text={option.label}
      />
    );
  };

  const renderSearchRightElement = (): React.ReactElement => (
    <div className="rm-find-or-create-modal-header__right-actions flex items-center">
      {mode === "manage" && (isSearching || isAdding) ? (
        <Spinner className="mr-1" size={14} />
      ) : null}
      <Button
        aria-label="Close Quick Switcher"
        className="rm-find-or-create-modal-header__right-icon"
        icon="cross"
        minimal
        onClick={onClose}
        small
      />
    </div>
  );

  const renderSearchHeader = (): React.ReactElement => (
    <div className="rm-find-or-create-modal-header">
      <div className="px-2 pt-2">
        <InputGroup
          autoComplete="off"
          className="rm-find-or-create-modal-header__search-bar"
          fill
          inputRef={mode === "manage" ? manageInputRef : openInputRef}
          leftIcon="search"
          onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
            if (mode === "manage") {
              onManageEntryInputChange(event);
              return;
            }
            setQuery(event.target.value);
          }}
          onKeyDown={
            mode === "manage" ? onManageInputKeyDown : onOpenInputKeyDown
          }
          placeholder={
            mode === "manage"
              ? "Search pages and blocks to add"
              : "Search saved pages and blocks"
          }
          rightElement={renderSearchRightElement()}
          style={SEARCH_INPUT_STYLE}
          value={mode === "manage" ? entryInput : query}
        />
      </div>

      <div
        aria-label="Quick Switcher mode"
        className="rm-find-or-create-modal-filters"
        role="tablist"
        style={MODE_TABS_STYLE}
      >
        {MODE_OPTIONS.map((option) => (
          <React.Fragment key={option.mode}>
            {renderModeChip({ option })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );

  const getBookmarkBreadcrumbs = ({
    bookmark,
  }: {
    bookmark: QuickSwitcherBookmark;
  }): string[] =>
    getBookmarkTargetType({ bookmark }) === "block"
      ? bookmark.breadcrumbs || []
      : [];

  const renderBreadcrumbs = ({
    breadcrumbs,
  }: {
    breadcrumbs: string[];
  }): React.ReactElement | null => {
    if (!breadcrumbs.length) {
      return null;
    }

    return (
      <div className="rm-find-or-create-row__breadcrumb">
        {breadcrumbs.map((breadcrumb, index) => (
          <React.Fragment key={`${breadcrumb}-${index}`}>
            {index > 0 ? (
              <span className="rm-zoom-chevron px-1">&gt;</span>
            ) : null}
            <span className="rm-find-or-create-row__breadcrumb-segment">
              {breadcrumb}
            </span>
          </React.Fragment>
        ))}
      </div>
    );
  };

  const renderRowContent = ({
    breadcrumbs = [],
    title,
  }: {
    breadcrumbs?: string[];
    title: string;
  }): React.ReactElement => (
    <div
      className={`rm-find-or-create-row${
        breadcrumbs.length ? "rm-find-or-create-row--block" : ""
      }`}
    >
      <div className="rm-find-or-create-row__block">
        {renderBreadcrumbs({ breadcrumbs })}
        <div
          className={
            breadcrumbs.length
              ? "rm-find-or-create-row__snippet"
              : "rm-find-or-create-row__title"
          }
        >
          <span>{title}</span>
        </div>
      </div>
    </div>
  );

  const renderOriginalTitleButton = ({
    bookmark,
  }: {
    bookmark: QuickSwitcherBookmark;
  }): React.ReactElement | null => {
    const { originalTitle } = getBookmarkRowPresentation({ bookmark });
    if (!originalTitle) {
      return null;
    }

    const targetLabel = getBookmarkTargetLabel({ bookmark }).toLowerCase();
    return (
      <Tooltip
        content={
          <div className="max-w-sm">
            <div className="mb-1 font-semibold">Original {targetLabel}</div>
            <div className="break-words">{originalTitle}</div>
          </div>
        }
        hoverOpenDelay={250}
      >
        <Button
          aria-label={`Show original ${targetLabel}: ${originalTitle}`}
          icon="eye-open"
          minimal
          onClick={(event): void => {
            event.preventDefault();
            event.stopPropagation();
          }}
          small
        />
      </Tooltip>
    );
  };

  const renderAliasEditor = ({
    bookmark,
  }: {
    bookmark: QuickSwitcherBookmark;
  }): React.ReactElement => (
    <div
      className="min-w-0 py-1 pr-3"
      onClick={(event): void => event.stopPropagation()}
    >
      <InputGroup
        autoComplete="off"
        autoFocus
        fill
        onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
          setAliasInput(event.target.value)
        }
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>): void =>
          onAliasInputKeyDown({ bookmark, event })
        }
        placeholder="Alias"
        small
        value={aliasInput}
      />
      <div className="bp3-text-muted mt-1 truncate text-xs">
        {bookmark.title}
      </div>
    </div>
  );

  const renderEmptyState = ({
    message,
  }: {
    message: string;
  }): React.ReactElement => (
    <div className="bp3-text-muted flex min-h-[220px] items-center justify-center px-6 py-8 text-center text-sm">
      {message}
    </div>
  );

  const renderOpenList = (): React.ReactElement => {
    if (!visibleBookmarks.length) {
      return renderEmptyState({
        message: query.trim()
          ? "No saved entries match this search."
          : "No saved entries yet. Switch to Manage to add pages or blocks.",
      });
    }

    return (
      <Menu className="rm-find-or-create-modal-body__list">
        {visibleBookmarks.map((bookmark, index) => {
          const isSelected = selectedIndex === index;
          const { title } = getBookmarkRowPresentation({ bookmark });
          return (
            <MenuItem
              aria-selected={isSelected}
              key={bookmark.id}
              labelElement={
                isSelected ? renderOriginalTitleButton({ bookmark }) : null
              }
              onClick={(event): void =>
                onBookmarkRowClick({ bookmark, event })
              }
              onMouseEnter={(): void => setSelectedIndex(index)}
              multiline
              style={isSelected ? SELECTED_MENU_ITEM_STYLE : MENU_ITEM_STYLE}
              text={renderRowContent({
                breadcrumbs: getBookmarkBreadcrumbs({ bookmark }),
                title,
              })}
            />
          );
        })}
      </Menu>
    );
  };

  const renderSuggestionList = (): React.ReactElement | null => {
    if (!shouldShowSuggestions) {
      return null;
    }

    if (!suggestions.length) {
      return (
        <div className="bp3-text-muted px-3 py-2 text-sm">
          {isSearching ? "Searching..." : "No matching unsaved entries."}
        </div>
      );
    }

    return (
      <>
        <div className="bp3-text-muted px-3 pb-1 pt-2 text-xs font-semibold">
          Add to saved entries
        </div>
        <Menu className="rm-find-or-create-modal-body__list mx-2 mb-2 rounded border border-[#c5cbd3]">
          {suggestions.map((suggestion, index) => (
            <MenuItem
              aria-selected={selectedSuggestionIndex === index}
              key={getSuggestionTargetKey({ suggestion })}
              onClick={(): void => {
                addSuggestion({ suggestion });
              }}
              onMouseEnter={(): void => setSelectedSuggestionIndex(index)}
              style={
                selectedSuggestionIndex === index
                  ? SELECTED_MENU_ITEM_STYLE
                  : MENU_ITEM_STYLE
              }
              text={renderRowContent({
                breadcrumbs:
                  suggestion.targetType === "block"
                    ? suggestion.breadcrumbs || []
                    : [],
                title: suggestion.title,
              })}
            />
          ))}
        </Menu>
      </>
    );
  };

  const renderSavedEntryList = (): React.ReactElement => {
    if (!bookmarks.length) {
      return renderEmptyState({
        message: "No saved entries yet.",
      });
    }

    return (
      <Menu className="rm-find-or-create-modal-body__list">
        {bookmarks.map((bookmark) => {
          const isEditingAlias = editingAliasBookmarkId === bookmark.id;
          const { title } = getBookmarkRowPresentation({ bookmark });
          return (
            <MenuItem
              key={bookmark.id}
              labelElement={
                isEditingAlias ? (
                  <div className="flex items-center gap-1">
                    <Button
                      aria-label={`Save alias for ${bookmark.title}`}
                      icon="tick"
                      intent="success"
                      minimal
                      onClick={(event): void => {
                        event.preventDefault();
                        event.stopPropagation();
                        saveAliasEdit({ bookmark });
                      }}
                      small
                    />
                    <Button
                      aria-label={`Cancel alias edit for ${bookmark.title}`}
                      icon="cross"
                      minimal
                      onClick={(event): void => {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelAliasEdit();
                      }}
                      small
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    {renderOriginalTitleButton({ bookmark })}
                    <Button
                      aria-label={`Edit alias for ${bookmark.title}`}
                      icon="edit"
                      minimal
                      onClick={(event): void => {
                        event.preventDefault();
                        event.stopPropagation();
                        startAliasEdit({ bookmark });
                      }}
                      small
                    />
                    <Button
                      aria-label={`Delete ${bookmark.title}`}
                      icon="cross"
                      minimal
                      onClick={(event): void => {
                        event.preventDefault();
                        event.stopPropagation();
                        removeBookmark({ bookmark });
                      }}
                      small
                    />
                  </div>
                )
              }
              multiline
              onClick={(event): void => {
                event.preventDefault();
                if (isEditingAlias) {
                  return;
                }
                startAliasEdit({ bookmark });
              }}
              text={
                isEditingAlias
                  ? renderAliasEditor({ bookmark })
                  : renderRowContent({
                      breadcrumbs: getBookmarkBreadcrumbs({ bookmark }),
                      title,
                    })
              }
              style={MENU_ITEM_STYLE}
            />
          );
        })}
      </Menu>
    );
  };

  const renderManageList = (): React.ReactElement => (
    <>
      {renderSuggestionList()}
      {renderSavedEntryList()}
    </>
  );

  const renderFooter = (): React.ReactElement => {
    const primaryText = mode === "manage" ? "Add" : "Open";

    return (
      <div className="rm-find-or-create-footer" style={FOOTER_STYLE}>
        <div className="rm-find-or-create-footer__title" />
        <div className="rm-find-or-create-footer__actions">
          {mode === "open" ? (
            <>
              <FooterActionButton
                disabled={!visibleBookmarks.length}
                hotkeys={["shift"]}
                label="Open in sidebar"
                onClick={openSelectedBookmarkInSidebar}
                showEnter
              />
              <Divider />
            </>
          ) : null}
          <FooterActionButton
            disabled={mode === "open" && !visibleBookmarks.length}
            label={primaryText}
            onClick={(): void => {
              if (mode === "manage") {
                addSelectedSuggestion();
                return;
              }
              openSelectedBookmark();
            }}
            showEnter
          />
        </div>
      </div>
    );
  };

  return (
    <Dialog
      canEscapeKeyClose
      canOutsideClickClose
      className="rm-modal-dialog rm-modal-dialog--find-or-create"
      isOpen={isOpen}
      onClose={onClose}
      style={{ maxWidth: "calc(100vw - 16px)", width: 640 }}
    >
      <div className="rm-find-or-create-modal flex max-h-[76vh] min-h-[420px] flex-col overflow-hidden">
        {renderSearchHeader()}
        <div className="rm-find-or-create-modal-main min-h-0 flex-1">
          <div className="rm-find-or-create-modal-body-col min-h-0">
            <div className="rm-find-or-create-modal-body min-h-0 overflow-y-auto">
              {mode === "manage" ? renderManageList() : renderOpenList()}
            </div>
          </div>
        </div>
        {renderFooter()}
      </div>
    </Dialog>
  );
};

export default QuickSwitcherDialog;
