import type {ChatMessage} from './assistantService';
const prefix='da_assistant_conversation:';
export function readConversation(owner:string):ChatMessage[] {
 try{
  const saved=JSON.parse(sessionStorage.getItem(prefix+owner)||'null');
  if(!saved||typeof saved.savedAt!=='number'||Date.now()-saved.savedAt>8*3600000||!Array.isArray(saved.messages))return [];
  return saved.messages.filter((message:any)=>message&&['user','assistant'].includes(message.sender)&&typeof message.text==='string'&&typeof message.id==='string').slice(-30);
 }catch{return [];}
}
export function saveConversation(owner:string,messages:ChatMessage[]) {
 try{sessionStorage.setItem(prefix+owner,JSON.stringify({savedAt:Date.now(),messages:messages.slice(-30).map(({id,sender,text,timestamp,action})=>({id,sender,text:text.slice(0,8000),timestamp,...(action&&['navigate','open_login'].includes(action.type)?{action}:{})}))}));}catch{/* Conversation memory is optional when browser storage is unavailable. */}
}
export function clearConversations() {
 try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith(prefix))sessionStorage.removeItem(key);}}catch{/* Storage may be disabled. */}
}
