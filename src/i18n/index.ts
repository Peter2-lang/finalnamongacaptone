import { interfaceLabels } from './interfaceLabels';
import { en } from './en';
import { ceb } from './ceb';
import { fil } from './fil';

export type AppLanguage = 'en' | 'ceb' | 'fil';

export type TranslationKey = keyof typeof en | string;

export const dictionaries: Record<AppLanguage, Record<string, string>> = {
  en: { ...en, ...Object.fromEntries(Object.keys(interfaceLabels).map(label=>[`ui.${label}`,label])) },
  ceb: { ...en, ...ceb, ...Object.fromEntries(Object.entries(interfaceLabels).map(([label,value])=>[`ui.${label}`,value.ceb])) },
  fil: { ...en, ...fil, ...Object.fromEntries(Object.entries(interfaceLabels).map(([label,value])=>[`ui.${label}`,value.fil])) },
};

/**
 * Format string with interpolation variables:
 * replace {var} or {{var}} with params[var]
 */
export function formatTranslation(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(/\{\{?([^{}]+)\}?\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
  );
}

/** One fallback and interpolation policy for hooks, legacy services, and errors. */
export function resolveTranslation(language:AppLanguage,key:TranslationKey,paramsOrFallback?:Record<string,string|number>|string,fallback?:string) {
  const params = typeof paramsOrFallback === 'object' ? paramsOrFallback : undefined;
  const defaultText = typeof paramsOrFallback === 'string' ? paramsOrFallback : fallback;
  const read=(dictionary:Record<string,string>,lookup:string) => Object.hasOwn(dictionary,lookup) && typeof dictionary[lookup]==='string' ? dictionary[lookup] : undefined;
  const template = read(dictionaries[language] || dictionaries.en,key) || (defaultText ? read(dictionaries[language] || dictionaries.en,`ui.${defaultText}`) : undefined) || read(dictionaries.en,key) || defaultText || String(key).replace(/[_.]/g,' ').replace(/^./,char=>char.toUpperCase());
  return formatTranslation(template,params);
}
