import runExtension from "roamjs-components/util/runExtension";
import { render as renderToast } from "roamjs-components/components/Toast";
import initializeQuickSwitcher, {
  COMMAND_PALETTE_ENABLED_SETTING_KEY,
  COMMAND_PALETTE_PREFIX_SETTING_KEY,
} from "~/quickSwitcher";
import { DEFAULT_COMMAND_PALETTE_PREFIX } from "~/utils/quickSwitcher";

export default runExtension(async ({ extensionAPI }) => {
  const quickSwitcher = initializeQuickSwitcher({ extensionAPI });
  const commandPaletteSettings = quickSwitcher.getCommandPaletteSettings();

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
        id: "manage-saved-entries",
        name: "Saved Entries",
        description: "Add or remove saved Quick Switcher entries.",
        action: {
          type: "button",
          content: "Manage Saved Entries",
          onClick: () => quickSwitcher.open({ mode: "manage" }),
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
