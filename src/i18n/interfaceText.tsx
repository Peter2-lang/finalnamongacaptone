import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { languageService } from '../services/languageService';
import { en } from './en';
export const interfaceKey = (source:string) => `ui.${source}`;
const existingKeys = new Map<string,string>(Object.entries(en).map(([key,value])=>[value,key]));
export function translateInterfaceText(source:string) {
  return languageService.t(existingKeys.get(source) || interfaceKey(source),source);
}
/** Renders only a text node: no layout, focus, inputs or DOM mutation. */
export function InterfaceText({source}:{source:string}) {
  useLanguage();
  return <>{translateInterfaceText(source)}</>;
}
