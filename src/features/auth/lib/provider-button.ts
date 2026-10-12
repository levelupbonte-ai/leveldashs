/**
 * Shared look of the provider buttons (Google, passkey): the outline button of
 * the theme, full width, 40 px, so both read as one set in light and dark mode.
 */
export const PROVIDER_BUTTON =
  'h-10 w-full gap-3 rounded-lg border-border bg-background text-sm font-medium text-foreground shadow-xs hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50';

/**
 * Hover and focus of the button while an invisible element on top of it (Google's
 * button) takes the pointer and the keyboard: they follow the `group/provider` wrapper.
 */
export const PROVIDER_BUTTON_COVERED =
  'group-hover/provider:bg-muted dark:group-hover/provider:bg-input/50 group-focus-within/provider:border-ring group-focus-within/provider:ring-3 group-focus-within/provider:ring-ring/50';
