import type { UserAccount, UserRole } from '../types';
import { languageService } from './languageService';
import { storageService } from './storageService';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  action?: {
    type: 'navigate' | 'confirm_action' | 'confirm_config_change' | 'filter_gis' | 'open_login';
    tab?: string;
    label?: string;
    actionId?: string;
    payload?: any;
    confirmed?: boolean;
  };
  suggestions?: string[];
}

export interface AssistantResponse {
  reply: string;
  action?: ChatMessage['action'];
  suggestions?: string[];
}

export const PUBLIC_ASSISTANT_SUGGESTIONS = [
  'What is the Swine Registry?',
  'How do I register my swine?',
  'What are the requirements?',
  'What are the official contact details?',
  'What barangays are covered?',
  'What should I do if my pigs are sick?',
];

type History = Array<{role:'user'|'assistant';text:string}>;
async function requestAssistant(path:string,message:string,history:History,authenticated:boolean):Promise<AssistantResponse> {
  if (!navigator.onLine || storageService.getSimulatedOffline()) return {reply:languageService.t('assistant_offline')};
  try {
    const token = authenticated ? storageService.getSessionToken() : null;
    const response = await fetch(path,{
      method:'POST',signal:AbortSignal.timeout(55000),
      headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})},
      body:JSON.stringify({message,language:languageService.getLanguage(),history:history.slice(-16).map(turn=>({role:turn.role,content:turn.text}))}),
    });
    const data=await response.json().catch(()=>null);
    if (!response.ok || data?.success!==true) throw new Error(data?.error || languageService.t('assistant_unavailable'));
    if(typeof data.reply!=='string'||!data.reply.trim()||data.reply.trim().toLowerCase()===message.trim().toLowerCase()) throw new Error(languageService.t('assistant_invalid_reply'));
    return {reply:data.reply.trim(),action:data.action,suggestions:Array.isArray(data.suggestions)?data.suggestions:undefined};
  } catch(error) {
    return {reply:error instanceof Error && error.name!=='TimeoutError' && error.name!=='TypeError' ? error.message : languageService.t('assistant_unavailable')};
  }
}
export const assistantService = {
  askPublicAssistant(message:string,history:History=[]):Promise<AssistantResponse> {
    return requestAssistant('/api/public/assistant/chat',message,history,false);
  },
  askAssistant(message:string,user:UserAccount|null,role:UserRole|'landing',history:History=[]):Promise<AssistantResponse> {
    return !user||role==='landing' ? this.askPublicAssistant(message,history) : requestAssistant('/api/assistant/chat',message,history,true);
  },
};
