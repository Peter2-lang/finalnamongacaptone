import { AppLanguage, dictionaries, formatTranslation, resolveTranslation, TranslationKey } from '../i18n';

const LANGUAGE_STORAGE_KEY = 'app_language';
const LANGUAGE_EVENT = 'app_language_change';

class LanguageService {
  private currentLanguage: AppLanguage = 'en';

  constructor() {
    this.init();
    if (typeof window !== 'undefined') window.addEventListener('storage', event => {
      if (event.key === LANGUAGE_STORAGE_KEY && ['en','ceb','fil'].includes(event.newValue || '')) this.setLanguage(event.newValue as AppLanguage);
    });
  }

  private init() {
    try {
      const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === 'en' || stored === 'ceb' || stored === 'fil') {
        this.currentLanguage = stored;
      } else {
        this.currentLanguage = 'en';
      }
    } catch {
      this.currentLanguage = 'en';
    }
  }

  public getLanguage(): AppLanguage {
    return this.currentLanguage;
  }

  public setLanguage(lang: AppLanguage): void {
    if (lang !== 'en' && lang !== 'ceb' && lang !== 'fil') return;
    this.currentLanguage = lang;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch (e) {
      console.warn('Could not save language to localStorage:', e);
    }

    document.documentElement.lang = lang;
    // Broadcast across windows/components for instant real-time update
    window.dispatchEvent(
      new CustomEvent(LANGUAGE_EVENT, {
        detail: { language: lang },
      })
    );
  }

  public t(
    key: TranslationKey,
    paramsOrFallback?: Record<string, string | number> | string,
    fallback?: string
  ): string {
    return resolveTranslation(this.currentLanguage,key,paramsOrFallback,fallback);
  }

  public onLanguageChange(callback: (lang: AppLanguage) => void): () => void {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ language: AppLanguage }>;
      if (customEvent.detail?.language) {
        callback(customEvent.detail.language);
      } else {
        callback(this.getLanguage());
      }
    };

    window.addEventListener(LANGUAGE_EVENT, handler);
    return () => window.removeEventListener(LANGUAGE_EVENT, handler);
  }
}

export const languageService = new LanguageService();
export { dictionaries, formatTranslation } from '../i18n';
export type { AppLanguage, TranslationKey } from '../i18n';
export type TranslationDictionary = Record<string, string>;
export const translations = dictionaries;
