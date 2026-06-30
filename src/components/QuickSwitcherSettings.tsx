import { Button, Card, FormGroup, InputGroup, Tag } from "@blueprintjs/core";
import React, { useMemo, useState } from "react";
import PageInput from "roamjs-components/components/PageInput";
import { render as renderToast } from "roamjs-components/components/Toast";
import getPageTitleByPageUid from "roamjs-components/queries/getPageTitleByPageUid";
import getPageUidByPageTitle from "roamjs-components/queries/getPageUidByPageTitle";
import type { QuickSwitcherBookmark } from "~/types/quickSwitcher";
import {
  buildRoamPageUrl,
  createBookmarkId,
  formatShortcutForDisplay,
  keyboardEventToShortcut,
  moveBookmarkByOffset,
  normalizeShortcut,
  shortcutHasModifier,
} from "~/utils/quickSwitcher";

type QuickSwitcherSettingsDependencies = {
  initialBookmarks: QuickSwitcherBookmark[];
  isMac: boolean;
  onBookmarksChange: (bookmarks: QuickSwitcherBookmark[]) => void;
};

type ToastIntent = "none" | "primary" | "success" | "warning" | "danger";

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

export const createQuickSwitcherSettingsComponent = ({
  initialBookmarks,
  isMac,
  onBookmarksChange,
}: QuickSwitcherSettingsDependencies): React.FC => {
  const QuickSwitcherSettings = (): React.ReactElement => {
    const [bookmarks, setBookmarks] =
      useState<QuickSwitcherBookmark[]>(initialBookmarks);
    const [pageTitle, setPageTitle] = useState("");
    const [shortcut, setShortcut] = useState("");

    const shortcutLabel = useMemo(
      () =>
        shortcut
          ? formatShortcutForDisplay({
              shortcut,
              isMac,
            })
          : "",
      [isMac, shortcut],
    );

    const setAndPersistBookmarks = ({
      nextBookmarks,
    }: {
      nextBookmarks: QuickSwitcherBookmark[];
    }): void => {
      setBookmarks(nextBookmarks);
      onBookmarksChange(nextBookmarks);
    };

    const clearForm = (): void => {
      setPageTitle("");
      setShortcut("");
    };

    const onShortcutKeyDown = (
      event: React.KeyboardEvent<HTMLInputElement>,
    ): void => {
      event.preventDefault();
      if (
        event.key === "Backspace" ||
        event.key === "Delete" ||
        event.key === "Escape"
      ) {
        setShortcut("");
        return;
      }
      const nextShortcut = keyboardEventToShortcut({ event });
      if (!nextShortcut) {
        return;
      }
      setShortcut(nextShortcut);
    };

    const addBookmark = (): void => {
      const normalizedPageTitle = pageTitle.trim();
      if (!normalizedPageTitle) {
        showToast({
          content: "Select a Roam page first",
          intent: "warning",
        });
        return;
      }

      const pageUid = getPageUidByPageTitle(normalizedPageTitle);
      if (!pageUid) {
        showToast({
          content: "That page does not exist in this graph",
          intent: "warning",
        });
        return;
      }

      const normalizedShortcut = normalizeShortcut({ shortcut });
      if (!normalizedShortcut) {
        showToast({
          content: "Capture a shortcut before adding",
          intent: "warning",
        });
        return;
      }

      if (!shortcutHasModifier({ shortcut: normalizedShortcut })) {
        showToast({
          content: "Shortcut must include at least one modifier key",
          intent: "warning",
        });
        return;
      }

      const existingPage = bookmarks.find(
        (bookmark) => bookmark.pageUid === pageUid,
      );
      if (existingPage) {
        showToast({
          content: `"${existingPage.title}" is already bookmarked`,
          intent: "warning",
        });
        return;
      }

      const existingShortcut = bookmarks.find(
        (bookmark) => bookmark.shortcut === normalizedShortcut,
      );
      if (existingShortcut) {
        showToast({
          content: `Shortcut already used by "${existingShortcut.title}"`,
          intent: "warning",
        });
        return;
      }

      const resolvedTitle =
        getPageTitleByPageUid(pageUid) || normalizedPageTitle;
      const url = buildRoamPageUrl({ pageUid });
      if (!url) {
        showToast({
          content: "Could not resolve a URL for this page",
          intent: "danger",
        });
        return;
      }

      const nextBookmarks = [
        ...bookmarks,
        {
          id: createBookmarkId(),
          title: resolvedTitle,
          pageUid,
          url,
          shortcut: normalizedShortcut,
        },
      ];

      setAndPersistBookmarks({ nextBookmarks });
      clearForm();
      showToast({
        content: "Bookmark added",
        intent: "success",
      });
    };

    return (
      <div className="flex flex-col gap-4">
        <FormGroup
          helperText="Start typing to pick from existing Roam pages."
          label="Page"
        >
          <PageInput
            id="quick-switcher-settings-page-input"
            placeholder="Type a page title"
            setValue={setPageTitle}
            value={pageTitle}
          />
        </FormGroup>

        <FormGroup
          helperText="Click then press your keys (e.g. Ctrl + Shift + 1)."
          label="Shortcut"
        >
          <InputGroup
            onKeyDown={onShortcutKeyDown}
            placeholder="Capture shortcut"
            readOnly
            value={shortcutLabel}
          />
        </FormGroup>

        <div className="flex flex-wrap gap-2">
          <Button intent="primary" onClick={addBookmark} text="Add Bookmark" />
          <Button minimal onClick={clearForm} text="Clear" />
        </div>

        <div className="flex flex-col gap-2">
          {bookmarks.length ? (
            bookmarks.map((bookmark, index) => (
              <Card
                className="flex items-start justify-between gap-2"
                elevation={0}
                key={bookmark.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{bookmark.title}</div>
                  <div className="truncate text-xs text-slate-500">
                    {bookmark.url}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Tag minimal>
                    {formatShortcutForDisplay({
                      shortcut: bookmark.shortcut,
                      isMac,
                    })}
                  </Tag>
                  <Button
                    disabled={index === 0}
                    icon="arrow-up"
                    minimal
                    onClick={(): void =>
                      setAndPersistBookmarks({
                        nextBookmarks: moveBookmarkByOffset({
                          bookmarks,
                          index,
                          offset: -1,
                        }),
                      })
                    }
                    small
                  />
                  <Button
                    disabled={index >= bookmarks.length - 1}
                    icon="arrow-down"
                    minimal
                    onClick={(): void =>
                      setAndPersistBookmarks({
                        nextBookmarks: moveBookmarkByOffset({
                          bookmarks,
                          index,
                          offset: 1,
                        }),
                      })
                    }
                    small
                  />
                  <Button
                    icon="trash"
                    intent="danger"
                    minimal
                    onClick={(): void =>
                      setAndPersistBookmarks({
                        nextBookmarks: bookmarks.filter(
                          (b) => b.id !== bookmark.id,
                        ),
                      })
                    }
                    small
                  />
                </div>
              </Card>
            ))
          ) : (
            <div className="bp3-text-muted text-sm">
              No bookmarks configured yet.
            </div>
          )}
        </div>
      </div>
    );
  };

  return QuickSwitcherSettings;
};
