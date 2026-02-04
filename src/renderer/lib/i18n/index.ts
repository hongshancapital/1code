import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// 导入翻译资源
import commonEn from './locales/en/common.json'
import commonZh from './locales/zh/common.json'
import settingsEn from './locales/en/settings.json'
import settingsZh from './locales/zh/settings.json'
import onboardingEn from './locales/en/onboarding.json'
import onboardingZh from './locales/zh/onboarding.json'
import chatEn from './locales/en/chat.json'
import chatZh from './locales/zh/chat.json'
import sidebarEn from './locales/en/sidebar.json'
import sidebarZh from './locales/zh/sidebar.json'
import toastEn from './locales/en/toast.json'
import toastZh from './locales/zh/toast.json'
import dialogsEn from './locales/en/dialogs.json'
import dialogsZh from './locales/zh/dialogs.json'
import homeEn from './locales/en/home.json'
import homeZh from './locales/zh/home.json'

export const defaultNS = 'common'
export const resources = {
  en: {
    common: commonEn,
    settings: settingsEn,
    onboarding: onboardingEn,
    chat: chatEn,
    sidebar: sidebarEn,
    toast: toastEn,
    dialogs: dialogsEn,
    home: homeEn,
  },
  zh: {
    common: commonZh,
    settings: settingsZh,
    onboarding: onboardingZh,
    chat: chatZh,
    sidebar: sidebarZh,
    toast: toastZh,
    dialogs: dialogsZh,
    home: homeZh,
  },
} as const

// Get initial language from localStorage preference
// The preference can be "system", "en", or "zh"
// If "system", we detect from navigator; otherwise use the explicit choice
function getInitialLanguage(): string {
  const stored = localStorage.getItem('preferences:language')
  // Remove quotes if stored as JSON string (atomWithStorage format)
  const preference = stored?.replace(/^"|"$/g, '') ?? 'system'

  if (preference === 'system') {
    const systemLocale = navigator.language
    return systemLocale.startsWith('zh') ? 'zh' : 'en'
  }

  // Return the explicit language choice if it's valid
  if (preference === 'en' || preference === 'zh') {
    return preference
  }

  // Fallback to English
  return 'en'
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh'],
    interpolation: { escapeValue: false },
  })

export default i18n
