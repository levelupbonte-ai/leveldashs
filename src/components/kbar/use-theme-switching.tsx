import { useRegisterActions } from 'kbar';
import { useTheme } from 'next-themes';
import { useThemeConfig } from '@/components/themes/active-theme';
import { THEMES } from '@/components/themes/theme.config';
import { useTranslations } from 'next-intl';

const useThemeSwitching = () => {
  const { theme, setTheme } = useTheme();
  const { activeTheme, setActiveTheme } = useThemeConfig();
  const t = useTranslations('common.theme');

  const toggleDarkLight = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const cycleTheme = () => {
    const currentIndex = THEMES.findIndex((t) => t.value === activeTheme);
    const nextIndex = (currentIndex + 1) % THEMES.length;
    setActiveTheme(THEMES[nextIndex].value);
  };

  const themeActions = [
    {
      id: 'cycleTheme',
      name: t('switch'),
      shortcut: ['t', 't'],
      section: t('label'),
      perform: cycleTheme
    },
    {
      id: 'toggleDarkLight',
      name: t('toggleMode'),
      shortcut: ['d', 'd'],
      section: t('label'),
      perform: toggleDarkLight
    },
    {
      id: 'setLightTheme',
      name: t('setLight'),
      section: t('label'),
      perform: () => setTheme('light')
    },
    {
      id: 'setDarkTheme',
      name: t('setDark'),
      section: t('label'),
      perform: () => setTheme('dark')
    }
  ];

  useRegisterActions(themeActions, [theme, activeTheme, t]);
};

export default useThemeSwitching;
