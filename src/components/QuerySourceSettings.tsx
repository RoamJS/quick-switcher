import {
  Button,
  FormGroup,
  InputGroup,
  Menu,
  MenuItem,
  Spinner,
  Tag,
} from "@blueprintjs/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { render as renderToast } from "roamjs-components/components/Toast";
import type { QuickSwitcherQuerySource } from "~/types/quickSwitcher";
import { extractQueryBlockAlias } from "~/utils/quickSwitcher";

type QuerySourceSettingsDependencies = {
  initialQuerySource: QuickSwitcherQuerySource;
  onQuerySourceChange: (querySource: QuickSwitcherQuerySource) => void;
};

type QuerySourceSuggestion = {
  uid: string;
  label: string;
  value: string;
  targetType: "query-block" | "query-page";
  detail: string;
};

type ToastIntent = "none" | "primary" | "success" | "warning" | "danger";

const MAX_QUERY_SOURCE_SUGGESTIONS = 12;

const showToast = ({
  content,
  intent = "none",
}: {
  content: string;
  intent?: ToastIntent;
}): void => {
  renderToast({
    id: `quick-switcher-query-source-toast-${Date.now()}`,
    content,
    intent,
    timeout: 2200,
  });
};

const getQueryBlockAlias = ({ text }: { text: string }): string =>
  extractQueryBlockAlias({ value: text }) || "";

const deriveQueryBlockLabel = ({
  text,
  uid,
}: {
  text: string;
  uid: string;
}): string => getQueryBlockAlias({ text }) || `Query block ${uid}`;

const getQueryBuilderApi = (): {
  listActiveQueries?: () => { uid: string }[];
} | null =>
  (
    window as Window & {
      roamjs?: {
        extension?: {
          queryBuilder?: {
            listActiveQueries?: () => { uid: string }[];
          };
        };
      };
    }
  ).roamjs?.extension?.queryBuilder || null;

const getActiveQueryUids = (): string[] => {
  try {
    return (getQueryBuilderApi()?.listActiveQueries?.() || [])
      .map((query) => query.uid)
      .filter(Boolean);
  } catch (error) {
    return [];
  }
};

const toBlockSuggestion = ({
  uid,
  text,
}: {
  uid: string;
  text: string;
}): QuerySourceSuggestion => {
  return {
    uid,
    label: deriveQueryBlockLabel({ text, uid }),
    value: uid,
    targetType: "query-block",
    detail: uid,
  };
};

const toPageSuggestion = ({
  uid,
  title,
}: {
  uid: string;
  title: string;
}): QuerySourceSuggestion => ({
  uid,
  label: title,
  value: uid,
  targetType: "query-page",
  detail: uid,
});

const resolveQuerySourceUid = async ({
  uid,
}: {
  uid: string;
}): Promise<QuerySourceSuggestion | null> => {
  const pulled = (await window.roamAlphaAPI.data.async.pull(
    "[:block/uid :block/string :node/title]",
    [":block/uid", uid],
  )) as {
    ":block/uid"?: string;
    ":block/string"?: string;
    ":node/title"?: string;
  } | null;
  const resolvedUid = pulled?.[":block/uid"] || uid;
  const pageTitle = pulled?.[":node/title"] || "";
  if (pageTitle) {
    return toPageSuggestion({ uid: resolvedUid, title: pageTitle });
  }

  const blockText = pulled?.[":block/string"] || "";
  if (!blockText) {
    return null;
  }
  return toBlockSuggestion({ uid: resolvedUid, text: blockText });
};

const searchQuerySources = async ({
  query,
}: {
  query: string;
}): Promise<QuerySourceSuggestion[]> => {
  const activeQueryUids = getActiveQueryUids();
  const activeSuggestions = (
    await Promise.all(
      activeQueryUids.map((uid) =>
        resolveQuerySourceUid({ uid }).catch(() => null),
      ),
    )
  ).filter((suggestion): suggestion is QuerySourceSuggestion =>
    Boolean(suggestion),
  );

  const normalizedQuery = query.trim().toLowerCase();
  const seen = new Set<string>();
  const suggestions: QuerySourceSuggestion[] = [];
  const addSuggestion = (suggestion: QuerySourceSuggestion): void => {
    const key = `${suggestion.targetType}:${suggestion.uid}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    suggestions.push(suggestion);
  };

  activeSuggestions
    .filter(
      (suggestion) =>
        suggestion.label.toLowerCase().includes(normalizedQuery) ||
        suggestion.value.toLowerCase().includes(normalizedQuery) ||
        suggestion.detail.toLowerCase().includes(normalizedQuery),
    )
    .forEach(addSuggestion);

  return suggestions
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, MAX_QUERY_SOURCE_SUGGESTIONS);
};

export const createQuerySourceSettingsComponent = ({
  initialQuerySource,
  onQuerySourceChange,
}: QuerySourceSettingsDependencies): React.FC => {
  const QuerySourceSettings = (): React.ReactElement => {
    const [value, setValue] = useState(initialQuerySource.queryRef);
    const [savedValue, setSavedValue] = useState(initialQuerySource.queryRef);
    const [suggestions, setSuggestions] = useState<QuerySourceSuggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const searchRequestRef = useRef(0);

    const normalizedValue = value.trim();
    const isDirty = normalizedValue !== savedValue;
    const shouldShowSuggestions =
      isInputFocused && (isSearching || suggestions.length > 0);

    useEffect((): void | (() => void) => {
      const query = value.trim();
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
        void searchQuerySources({ query })
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
    }, [value]);

    const persistValue = useCallback(
      ({ nextValue }: { nextValue: string }): void => {
        const queryRef = nextValue.trim();
        setValue(queryRef);
        setSavedValue(queryRef);
        setSuggestions([]);
        setIsInputFocused(false);
        onQuerySourceChange({
          enabled: Boolean(queryRef),
          queryRef,
        });
        showToast({
          content: queryRef
            ? "Query Builder source saved"
            : "Query Builder source cleared",
          intent: "success",
        });
      },
      [onQuerySourceChange],
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
          persistValue({
            nextValue: selectedSuggestion?.value || value,
          });
          return;
        }

        if (event.key === "Escape") {
          setSuggestions([]);
          setIsInputFocused(false);
        }
      },
      [persistValue, selectedIndex, suggestions, value],
    );

    return (
      <FormGroup
        helperText="Search active Query Builder queries by alias, page, or UID."
        label="Source"
      >
        <div className="flex items-start gap-2">
          <div className="relative min-w-0 flex-1">
            <InputGroup
              autoComplete="off"
              leftIcon="search"
              onBlur={(): void => {
                window.setTimeout(() => setIsInputFocused(false), 120);
              }}
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
                setValue(event.target.value);
                setIsInputFocused(true);
              }}
              onFocus={(): void => setIsInputFocused(true)}
              onKeyDown={onInputKeyDown}
              placeholder="Search Query Builder queries"
              rightElement={
                isSearching ? <Spinner className="mr-2" size={16} /> : undefined
              }
              value={value}
            />
            {shouldShowSuggestions ? (
              <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded border border-slate-200 bg-white shadow-lg">
                {suggestions.length ? (
                  <Menu>
                    {suggestions.map((suggestion, index) => (
                      <MenuItem
                        active={selectedIndex === index}
                        icon={
                          suggestion.targetType === "query-page"
                            ? "document"
                            : "filter-list"
                        }
                        key={`${suggestion.targetType}:${suggestion.uid}`}
                        labelElement={
                          <Tag minimal>
                            {suggestion.targetType === "query-page"
                              ? "Page"
                              : "Query"}
                          </Tag>
                        }
                        multiline
                        onClick={(): void =>
                          persistValue({ nextValue: suggestion.value })
                        }
                        onMouseEnter={(): void => setSelectedIndex(index)}
                        text={
                          <div className="flex min-w-0 flex-col gap-1 py-1 pr-3">
                            <div className="truncate">{suggestion.label}</div>
                            <div className="truncate text-xs text-slate-500">
                              {suggestion.detail}
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
            disabled={!isDirty}
            icon="floppy-disk"
            intent="primary"
            onClick={(): void => persistValue({ nextValue: value })}
            text="Save"
          />
          <Button
            disabled={!normalizedValue && !savedValue}
            icon="cross"
            minimal
            onClick={(): void => persistValue({ nextValue: "" })}
          />
        </div>
      </FormGroup>
    );
  };

  return QuerySourceSettings;
};
