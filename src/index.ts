import runExtension from "roamjs-components/util/runExtension";
import { render as renderToast } from "roamjs-components/components/Toast";
import initializeQuickSwitcher, {
  COMMAND_PALETTE_ENABLED_SETTING_KEY,
  COMMAND_PALETTE_PREFIX_SETTING_KEY,
  QUERY_SOURCE_REF_SETTING_KEY,
} from "~/quickSwitcher";
import { createQuickSwitcherSettingsComponent } from "~/components/QuickSwitcherSettings";
import { createQuerySourceSettingsComponent } from "~/components/QuerySourceSettings";
import { DEFAULT_COMMAND_PALETTE_PREFIX } from "~/utils/quickSwitcher";

export default runExtension(async ({ extensionAPI }) => {
  const quickSwitcher = initializeQuickSwitcher({ extensionAPI });
  const commandPaletteSettings = quickSwitcher.getCommandPaletteSettings();
  const querySource = quickSwitcher.getQuerySource();

  if (
    typeof extensionAPI.settings.get(COMMAND_PALETTE_ENABLED_SETTING_KEY) !==
    "boolean"
  ) {
    await extensionAPI.settings.set(
      COMMAND_PALETTE_ENABLED_SETTING_KEY,
      commandPaletteSettings.enabled,
    );
  }
  if (
    typeof extensionAPI.settings.get(COMMAND_PALETTE_PREFIX_SETTING_KEY) !==
    "string"
  ) {
    await extensionAPI.settings.set(
      COMMAND_PALETTE_PREFIX_SETTING_KEY,
      commandPaletteSettings.prefix,
    );
  }
  if (
    typeof extensionAPI.settings.get(QUERY_SOURCE_REF_SETTING_KEY) !== "string"
  ) {
    await extensionAPI.settings.set(
      QUERY_SOURCE_REF_SETTING_KEY,
      querySource.queryRef,
    );
  }

  const settingsComponent = createQuickSwitcherSettingsComponent({
    initialBookmarks: quickSwitcher.getBookmarks(),
    onBookmarksChange: quickSwitcher.setBookmarks,
  });
  const querySourceComponent = createQuerySourceSettingsComponent({
    initialQuerySource: quickSwitcher.getQuerySource(),
    onQuerySourceChange: quickSwitcher.setQuerySource,
  });

  extensionAPI.settings.panel.create({
    tabTitle: "Quick Switcher",
    settings: [
      {
        id: "open-quick-switcher",
        name: "Open Dialog",
        description: "Open the Quick Switcher dialog",
        action: {
          type: "button",
          content: "Open Quick Switcher",
          onClick: () => quickSwitcher.open(),
        },
      },
      {
        id: "bookmarked-entries",
        name: "Saved Entries",
        description:
          "Add Roam pages or blocks by title, text, UID, URL, or block reference.",
        action: {
          type: "reactComponent",
          component: settingsComponent,
        },
      },
      {
        id: "query-builder-source",
        name: "Query Builder Source",
        description: "Use pages returned by a selected Query Builder query.",
        action: {
          type: "reactComponent",
          component: querySourceComponent,
        },
      },
      {
        id: COMMAND_PALETTE_ENABLED_SETTING_KEY,
        name: "Add Saved Entries To Command Palette",
        description:
          "Add one command palette command for each saved Quick Switcher entry.",
        action: {
          type: "switch",
          onChange: (event): void => {
            quickSwitcher.setCommandPaletteSettings({
              ...quickSwitcher.getCommandPaletteSettings(),
              enabled: event.target.checked,
            });
          },
        },
      },
      {
        id: COMMAND_PALETTE_PREFIX_SETTING_KEY,
        name: "Command Palette Prefix",
        description:
          "Saved entry commands use this prefix plus the entry title.",
        action: {
          type: "input",
          placeholder: DEFAULT_COMMAND_PALETTE_PREFIX,
          onChange: (event): void => {
            quickSwitcher.setCommandPaletteSettings({
              ...quickSwitcher.getCommandPaletteSettings(),
              prefix: event.target.value,
            });
          },
        },
      },
    ],
  });

  if (process.env.NODE_ENV === "development") {
    renderToast({
      id: "quick-switcher-loaded",
      content: "Successfully loaded Quick Switcher",
      intent: "success",
      timeout: 500,
    });
  }

  return {
    unload: () => {
      quickSwitcher.unload();
    },
  };
});
