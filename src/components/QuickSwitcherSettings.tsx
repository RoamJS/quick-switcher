import {
  Button,
  Card,
  Dialog,
  FormGroup,
  InputGroup,
  Switch,
  Tag,
  TextArea,
} from "@blueprintjs/core";
import React, { useMemo, useState } from "react";
import PageInput from "roamjs-components/components/PageInput";
import { render as renderToast } from "roamjs-components/components/Toast";
import getPageTitleByPageUid from "roamjs-components/queries/getPageTitleByPageUid";
import getPageUidByPageTitle from "roamjs-components/queries/getPageUidByPageTitle";
import type {
  QuickSwitcherBookmark,
  QuickSwitcherQuerySource,
} from "~/types/quickSwitcher";
import {
  buildRoamPageUrl,
  createBookmarkId,
  formatShortcutForDisplay,
  keyboardEventToShortcut,
  moveBookmarkByOffset,
  normalizeShortcut,
  parsePageUidFromUrl,
  shortcutHasModifier,
} from "~/utils/quickSwitcher";

type QuickSwitcherSettingsDependencies = {
  initialBookmarks: QuickSwitcherBookmark[];
  initialQuerySource: QuickSwitcherQuerySource;
  isMac: boolean;
  onBookmarksChange: (bookmarks: QuickSwitcherBookmark[]) => void;
  onQuerySourceChange: (querySource: QuickSwitcherQuerySource) => void;
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

const isPageUrlInput = ({ entry }: { entry: string }): boolean =>
  /^https?:\/\//i.test(entry) ||
  entry.startsWith("#/") ||
  entry.startsWith("/#/");

export const createQuickSwitcherSettingsComponent = ({
  initialBookmarks,
  initialQuerySource,
  isMac,
  onBookmarksChange,
  onQuerySourceChange,
}: QuickSwitcherSettingsDependencies): React.FC => {
  const QuickSwitcherSettings = (): React.ReactElement => {
    const [bookmarks, setBookmarks] =
      useState<QuickSwitcherBookmark[]>(initialBookmarks);
    const [savedQuerySource, setSavedQuerySource] =
      useState<QuickSwitcherQuerySource>(initialQuerySource);
    const [querySourceEnabled, setQuerySourceEnabled] = useState(
      initialQuerySource.enabled,
    );
    const [querySourceRef, setQuerySourceRef] = useState(
      initialQuerySource.queryRef,
    );
    const [isManageDialogOpen, setIsManageDialogOpen] = useState(false);
    const [pageTitle, setPageTitle] = useState("");
    const [shortcut, setShortcut] = useState("");
    const [bulkPages, setBulkPages] = useState("");

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
    const isQuerySourceDirty =
      querySourceEnabled !== savedQuerySource.enabled ||
      querySourceRef.trim() !== savedQuerySource.queryRef;

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

    const clearBulkPages = (): void => {
      setBulkPages("");
    };

    const resetQuerySource = (): void => {
      setQuerySourceEnabled(savedQuerySource.enabled);
      setQuerySourceRef(savedQuerySource.queryRef);
    };

    const closeManageDialog = (): void => {
      setIsManageDialogOpen(false);
      clearForm();
      clearBulkPages();
      resetQuerySource();
    };

    const onShortcutKeyDown = (
      event: React.KeyboardEvent<HTMLInputElement>,
    ): void => {
      event.preventDefault();
      event.stopPropagation();
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

      const normalizedShortcut = shortcut
        ? normalizeShortcut({ shortcut })
        : null;
      if (shortcut && !normalizedShortcut) {
        showToast({
          content: "Capture a valid shortcut or leave it blank",
          intent: "warning",
        });
        return;
      }

      if (
        normalizedShortcut &&
        !shortcutHasModifier({ shortcut: normalizedShortcut })
      ) {
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

      const existingShortcut = normalizedShortcut
        ? bookmarks.find((bookmark) => bookmark.shortcut === normalizedShortcut)
        : null;
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

    const addBulkPages = (): void => {
      const entries = bulkPages
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (!entries.length) {
        showToast({
          content: "Add at least one page title or URL",
          intent: "warning",
        });
        return;
      }

      const existingPageUids = new Set(
        bookmarks
          .map((bookmark) => bookmark.pageUid)
          .filter((uid): uid is string => Boolean(uid)),
      );
      const nextBookmarks = [...bookmarks];
      let addedCount = 0;
      let skippedCount = 0;

      entries.forEach((entry) => {
        const pageUid = isPageUrlInput({ entry })
          ? parsePageUidFromUrl({ url: entry })
          : getPageUidByPageTitle(entry);
        const title = pageUid ? getPageTitleByPageUid(pageUid) : "";
        if (!pageUid || !title || existingPageUids.has(pageUid)) {
          skippedCount += 1;
          return;
        }

        const url = buildRoamPageUrl({ pageUid });
        if (!url) {
          skippedCount += 1;
          return;
        }

        existingPageUids.add(pageUid);
        addedCount += 1;
        nextBookmarks.push({
          id: createBookmarkId(),
          title,
          pageUid,
          url,
          shortcut: null,
        });
      });

      if (!addedCount) {
        showToast({
          content: "No new pages were added",
          intent: "warning",
        });
        return;
      }

      setAndPersistBookmarks({ nextBookmarks });
      clearBulkPages();
      showToast({
        content: `Added ${addedCount} ${addedCount === 1 ? "page" : "pages"}${
          skippedCount ? `, skipped ${skippedCount}` : ""
        }`,
        intent: "success",
      });
    };

    const saveQuerySource = (): void => {
      const normalizedQueryRef = querySourceRef.trim();
      if (querySourceEnabled && !normalizedQueryRef) {
        showToast({
          content: "Add a Query Builder query reference first",
          intent: "warning",
        });
        return;
      }

      const nextQuerySource = {
        enabled: querySourceEnabled,
        queryRef: normalizedQueryRef,
      };
      setSavedQuerySource(nextQuerySource);
      onQuerySourceChange(nextQuerySource);
      showToast({
        content: "Query Builder source saved",
        intent: "success",
      });
    };

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-end">
          <Button
            icon="edit"
            intent="primary"
            onClick={(): void => setIsManageDialogOpen(true)}
            text="Manage Pages"
          />
        </div>

        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border border-slate-200 p-2">
          {bookmarks.length ? (
            bookmarks.map((bookmark) => (
              <div
                className="flex min-h-[32px] items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-b-0"
                key={bookmark.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{bookmark.title}</div>
                </div>
                {bookmark.shortcut ? (
                  <Tag minimal>
                    {formatShortcutForDisplay({
                      shortcut: bookmark.shortcut,
                      isMac,
                    })}
                  </Tag>
                ) : null}
              </div>
            ))
          ) : (
            <div className="bp3-text-muted text-sm">
              No bookmarks configured yet.
            </div>
          )}
        </div>

        <Dialog
          canEscapeKeyClose
          canOutsideClickClose
          icon="edit"
          isOpen={isManageDialogOpen}
          onClose={closeManageDialog}
          style={{ maxWidth: "95vw", width: 720 }}
          title="Manage Quick Switcher Pages"
        >
          <div className="bp3-dialog-body flex max-h-[72vh] flex-col gap-4 overflow-y-auto">
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
              helperText="Optional. Click then press your keys (e.g. Ctrl + Shift + 1)."
              label="Shortcut"
            >
              <InputGroup
                onKeyDown={onShortcutKeyDown}
                placeholder="Capture optional shortcut"
                readOnly
                value={shortcutLabel}
              />
            </FormGroup>

            <div className="flex flex-wrap gap-2">
              <Button
                intent="primary"
                onClick={addBookmark}
                text="Add Bookmark"
              />
              <Button minimal onClick={clearForm} text="Clear" />
            </div>

            <FormGroup
              helperText="One existing page title or Roam page URL per line."
              label="Bulk Add Pages"
            >
              <TextArea
                fill
                growVertically
                onChange={(
                  event: React.ChangeEvent<HTMLTextAreaElement>,
                ): void => setBulkPages(event.target.value)}
                placeholder="Project Home&#10;https://roamresearch.com/#/app/graph/page/abc123"
                rows={4}
                value={bulkPages}
              />
            </FormGroup>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!bulkPages.trim()}
                icon="multi-select"
                onClick={addBulkPages}
                text="Add Pages"
              />
              <Button minimal onClick={clearBulkPages} text="Clear Bulk" />
            </div>

            <div className="rounded border border-slate-200 p-3">
              <Switch
                checked={querySourceEnabled}
                label="Include Query Builder pages"
                onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                  setQuerySourceEnabled(event.target.checked)
                }
              />
              <FormGroup
                helperText="Use a query page title, query block label, block UID, or block reference."
                label="Query Builder Source"
              >
                <InputGroup
                  disabled={!querySourceEnabled}
                  onChange={(
                    event: React.ChangeEvent<HTMLInputElement>,
                  ): void => setQuerySourceRef(event.target.value)}
                  placeholder="Active Projects, queries/Active Projects, or ((abc123def))"
                  value={querySourceRef}
                />
              </FormGroup>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!isQuerySourceDirty}
                  icon="floppy-disk"
                  onClick={saveQuerySource}
                  text="Save Source"
                />
                <Button
                  disabled={!isQuerySourceDirty}
                  minimal
                  onClick={resetQuerySource}
                  text="Reset"
                />
              </div>
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
                      <div className="truncate font-medium">
                        {bookmark.title}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {bookmark.url}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {bookmark.shortcut ? (
                        <Tag minimal>
                          {formatShortcutForDisplay({
                            shortcut: bookmark.shortcut,
                            isMac,
                          })}
                        </Tag>
                      ) : null}
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
        </Dialog>
      </div>
    );
  };

  return QuickSwitcherSettings;
};
