import runExtension from "roamjs-components/util/runExtension";
import { render as renderToast } from "roamjs-components/components/Toast";
import initializeQuickSwitcher from "~/quickSwitcher";
import { createQuickSwitcherSettingsComponent } from "~/components/QuickSwitcherSettings";

export default runExtension(async ({ extensionAPI }) => {
  const quickSwitcher = initializeQuickSwitcher({ extensionAPI });
  const settingsComponent = createQuickSwitcherSettingsComponent({
    initialBookmarks: quickSwitcher.getBookmarks(),
    initialQuerySource: quickSwitcher.getQuerySource(),
    isMac: /mac|iphone|ipad|ipod/i.test(
      typeof navigator === "undefined"
        ? ""
        : `${navigator.platform} ${navigator.userAgent}`,
    ),
    onBookmarksChange: quickSwitcher.setBookmarks,
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
        id: "bookmarked-pages",
        name: "Bookmarked Pages",
        description:
          "Add Roam pages with optional shortcuts and optional Query Builder pages.",
        action: {
          type: "reactComponent",
          component: settingsComponent,
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
