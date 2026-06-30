import { Dialog, InputGroup, Menu, MenuItem, Tag } from "@blueprintjs/core";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { QuickSwitcherBookmark } from "~/types/quickSwitcher";
import {
  filterBookmarks,
  formatShortcutForDisplay,
} from "~/utils/quickSwitcher";

type QuickSwitcherDialogProps = {
  isOpen: boolean;
  bookmarks: QuickSwitcherBookmark[];
  isMac: boolean;
  onClose: () => void;
  onOpenBookmark: (bookmark: QuickSwitcherBookmark) => void;
};

const getResultCountLabel = ({ count }: { count: number }): string =>
  `${count} ${count === 1 ? "bookmark" : "bookmarks"}`;

const QuickSwitcherDialog = ({
  isOpen,
  bookmarks,
  isMac,
  onClose,
  onOpenBookmark,
}: QuickSwitcherDialogProps): React.ReactElement => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const visibleBookmarks = useMemo(
    () =>
      filterBookmarks({
        bookmarks,
        query,
      }),
    [bookmarks, query],
  );

  useEffect((): void | (() => void) => {
    if (!isOpen) {
      setQuery("");
      setSelectedIndex(0);
      return;
    }
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  useEffect((): void => {
    if (selectedIndex < visibleBookmarks.length) {
      return;
    }
    setSelectedIndex(
      visibleBookmarks.length > 0 ? visibleBookmarks.length - 1 : 0,
    );
  }, [selectedIndex, visibleBookmarks.length]);

  const onInputKeyDown = useCallback(
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
        const bookmark = visibleBookmarks[selectedIndex];
        if (!bookmark) {
          return;
        }
        onOpenBookmark(bookmark);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    },
    [onClose, onOpenBookmark, selectedIndex, visibleBookmarks],
  );

  return (
    <Dialog
      canEscapeKeyClose
      canOutsideClickClose
      icon="search-template"
      isOpen={isOpen}
      onClose={onClose}
      style={{ maxWidth: "95vw", width: 760 }}
      title="Quick Switcher"
    >
      <div className="bp3-dialog-body flex max-h-[72vh] flex-col gap-3 overflow-hidden">
        <InputGroup
          autoComplete="off"
          inputRef={inputRef}
          leftIcon="search"
          onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
            setQuery(event.target.value)
          }
          onKeyDown={onInputKeyDown}
          placeholder="Search bookmarked pages"
          value={query}
        />

        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-slate-200 p-1">
          {visibleBookmarks.length ? (
            <Menu>
              {visibleBookmarks.map((bookmark, index) => (
                <MenuItem
                  active={selectedIndex === index}
                  icon="document-open"
                  key={bookmark.id}
                  labelElement={
                    bookmark.shortcut ? (
                      <Tag minimal>
                        {formatShortcutForDisplay({
                          shortcut: bookmark.shortcut,
                          isMac,
                        })}
                      </Tag>
                    ) : undefined
                  }
                  multiline
                  onClick={(): void => onOpenBookmark(bookmark)}
                  onMouseEnter={(): void => setSelectedIndex(index)}
                  text={
                    <div className="flex min-w-0 flex-col gap-1 py-1 pr-3">
                      <div className="truncate">{bookmark.title}</div>
                      <div className="truncate text-xs text-slate-500">
                        {bookmark.url}
                      </div>
                    </div>
                  }
                />
              ))}
            </Menu>
          ) : (
            <div className="bp3-text-muted flex h-full min-h-[140px] items-center justify-center text-sm">
              {query.trim()
                ? "No bookmarked pages match this search."
                : "No bookmarked pages yet. Add pages in Quick Switcher settings."}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs text-slate-500">
          <span>{getResultCountLabel({ count: visibleBookmarks.length })}</span>
          <span>Enter to open | Esc to close</span>
        </div>
      </div>
    </Dialog>
  );
};

export default QuickSwitcherDialog;
