import { supabase } from '../lib/supabase.ts';

/** Health is public; sending local changes requires a refreshed session and live profile. */
export async function requireSyncAuthorization(client = supabase, fetcher: typeof fetch = fetch) {
  const signIn = () => new Error('Please sign in again before synchronizing. Your pending changes are stored safely on this device.');
  if (!client) throw signIn();
  const {data,error} = await client.auth.getSession();
  if(error || !data.session)throw signIn();
  let session=data.session;
  if(session.expires_at && session.expires_at<=Math.floor(Date.now()/1000)+60){
    const refreshed=await client.auth.refreshSession();
    if(refreshed.error || !refreshed.data.session)throw signIn();
    session=refreshed.data.session;
  }
  const verified=await client.auth.getUser(session.access_token);
  if(verified.error || verified.data.user?.id!==session.user.id)throw signIn();
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`};
  const response=await fetcher('/api/auth/profile',{headers,cache:'no-store'});
  const body=await response.json().catch(()=>null);
  const profile=body?.data;
  if(!response.ok || !body?.success || !profile ||
    (profile.authUserId||profile.id)!==session.user.id || profile.active!==true || profile.isActive!==true || profile.status!=='active')throw signIn();
  return {userId:session.user.id,headers};
}

export function assertQueueOwnership(items:Array<{ownerUserId?:string}>,userId:string) {
  if(items.some(item=>item.ownerUserId!==userId))throw new Error('Some pending changes belong to another account or have no verified owner. They remain stored; sign in with the original account or ask an administrator to review them.');
}
