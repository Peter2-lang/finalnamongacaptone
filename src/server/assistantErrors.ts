/** Provider error details may contain headers or request payloads: expose only codes. */
export type AssistantErrorCode = 'provider_configuration'|'provider_quota'|'provider_timeout'|'provider_unavailable';
export function assistantErrorCode(error:unknown):AssistantErrorCode {
 const candidate=error as {status?:number;name?:string;message?:string};
 const status=Number(candidate?.status);
 const message=typeof candidate?.message==='string'?candidate.message:'';
 if(status===401||status===403||/API.?key.*(invalid|not valid|missing)|AI service is not configured|API_KEY_INVALID/i.test(message))return 'provider_configuration';
 if(status===429||/RESOURCE_EXHAUSTED/i.test(message))return 'provider_quota';
 if(status===504||/DEADLINE_EXCEEDED|deadline.*expired/i.test(message)||candidate?.name==='TimeoutError'||candidate?.name==='AbortError'||/timed? ?out/i.test(message))return 'provider_timeout';
 return 'provider_unavailable';
}
export function assistantErrorMessage(code:AssistantErrorCode,language:unknown,admin:boolean) {
 if(code==='provider_timeout') return language==='ceb'?'Milapas sa oras ang AI provider. Sulayi pag-usab. Magamit gihapon ang mga pangutana sa live nga rekord.':language==='fil'?'Naubusan ng oras ang AI provider. Subukang muli. Maaari pa ring magtanong tungkol sa kasalukuyang mga tala.':'The AI provider timed out. Please retry. Live registry questions are still available.';
 if(code==='provider_quota') return language==='ceb'?'Naabot ang limit sa AI provider. Sulayi pag-usab unya; magamit gihapon ang live nga rekord.':language==='fil'?'Naabot ang limitasyon ng AI provider. Subukan muli mamaya; magagamit pa rin ang kasalukuyang mga tala.':'The AI provider reached its usage limit. Retry later; live registry questions are still available.';
 if(admin&&code==='provider_configuration')return language==='ceb'?'Gisalikway sa AI provider ang credential. I-update sa luwas nga paagi ang server-side GEMINI_API_KEY ug i-deploy pag-usab.':language==='fil'?'Tinanggihan ng AI provider ang credential. Ligtas na i-update ang server-side GEMINI_API_KEY at mag-deploy muli.':'The AI provider rejected its credential. Securely update the server-side GEMINI_API_KEY and redeploy.';
 return language==='ceb'?'Dili magamit ang AI karon. Sulayi pag-usab. Para sa pinakabag-ong datos, ablihi ang gitugot nga pahina sa rekord.':language==='fil'?'Hindi magamit ang AI sa ngayon. Subukang muli. Tingnan ang awtorisadong pahina ng mga tala para sa pinakabagong datos.':'The AI assistant is temporarily unavailable. Please try again, or open your authorized records page for current data.';
}
