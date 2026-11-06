import React from 'react';
import {useLanguage} from '../context/LanguageContext';
import {dictionaries} from './index';
import {languageService} from '../services/languageService';
import {translateInterfaceText} from './interfaceText';

const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.values(dictionaries).flatMap(dictionary=>Object.entries(dictionary).flatMap(([key,template])=>{
 const names:string[]=[];let offset=0,expression='^';
 for(const match of template.matchAll(/\{([A-Za-z]\w*)\}/g)){
  expression+=escape(template.slice(offset,match.index))+'([\\s\\S]*?)';names.push(match[1]);offset=match.index!+match[0].length;
 }
 if(!names.length)return [];
 expression+=escape(template.slice(offset))+'$';return [{key,names,expression:new RegExp(expression)}];
}));
/** Localize UI feedback at render time so changing language never changes stored state. */
export function translateFeedback(source:string):string {
 for(const pattern of patterns){
  const match=pattern.expression.exec(source);if(!match)continue;
  const values:Record<string,string>={};let valid=true;
  pattern.names.forEach((name,index)=>{if(Object.hasOwn(values,name)&&values[name]!==match[index+1])valid=false;values[name]=match[index+1];});
  if(valid)return languageService.t(pattern.key,values,source);
 }
 const entry=Object.entries(dictionaries.en).find(([,text])=>text===source);
 if(entry)return languageService.t(entry[0],source);
 for(const dictionary of Object.values(dictionaries)){
  const translated=Object.entries(dictionary).find(([,text])=>text===source);
  if(translated)return languageService.t(translated[0],source);
 }
 return translateInterfaceText(source);
}
export function LocalizedFeedback({value}:{value:unknown}) {
 useLanguage();
 if(value==null||typeof value==='boolean')return null;
 if(typeof value==='string')return <>{translateFeedback(value)}</>;
 if(typeof value==='number'||React.isValidElement(value))return <>{value}</>;
 if(value instanceof Error)return <>{translateFeedback(value.message)}</>;
 return <>{translateInterfaceText('The operation could not be completed.')}</>;
}
