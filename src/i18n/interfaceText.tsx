import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { languageService } from '../services/languageService';
import { en } from './en';
export const interfaceKey = (source:string) => `ui.${source}`;
const existingKeys = new Map<string,string>(Object.entries(en).map(([key,value])=>[value,key]));
export function translateInterfaceText(source:string,params?:Record<string,unknown>) {
  const normalized=source.trim();
  if(!normalized)return source;
  const values=params?Object.fromEntries(Object.entries(params).map(([key,value])=>[key,String(value)])):undefined;
  const translated=languageService.t(existingKeys.get(normalized) || interfaceKey(normalized),values,normalized);
  return (source.match(/^\s*/)?.[0] || '')+translated+(source.match(/\s*$/)?.[0] || '');
}
/** Renders only a text node: no layout, focus, inputs or DOM mutation. */
export function InterfaceText({source}:{source:string}) {
  useLanguage();
  return <>{translateInterfaceText(source)}</>;
}
