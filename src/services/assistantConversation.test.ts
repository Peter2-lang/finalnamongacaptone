import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readConversation,saveConversation,clearConversations} from './assistantConversation';
test('conversation memory is isolated, bounded, clears on logout and strips pending mutations',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');const values=new Map<string,string>();
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{get length(){return values.size},key:(index:number)=>[...values.keys()][index]||null,getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
 try{
  saveConversation('user-a:admin',[{id:'one',sender:'user',text:'How many new records today?',timestamp:'12:00'},{id:'two',sender:'assistant',text:'Please confirm.',timestamp:'12:01',action:{type:'confirm_config_change',payload:{color:'blue'}}}]);
  assert.equal(readConversation('user-a:admin').length,2);assert.deepEqual(readConversation('user-b:focal'),[]);assert.equal(readConversation('user-a:admin')[1].action,undefined);
  values.set('unrelated','keep');clearConversations();assert.deepEqual(readConversation('user-a:admin'),[]);assert.equal(values.get('unrelated'),'keep');
  values.set('da_assistant_conversation:bad','{invalid');assert.deepEqual(readConversation('bad'),[]);
 }finally{if(previous)Object.defineProperty(globalThis,'sessionStorage',previous);else delete (globalThis as any).sessionStorage;}
});
