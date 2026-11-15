(() => {
 'use strict';
 const SERVICE='https://homehq-desk-companion.homehq-private-desk.workers.dev';
 const PROOF_KEY='desk.pending-sign-in.v1';
 const status=document.getElementById('access-status'),signIn=document.getElementById('sign-in'),signOut=document.getElementById('sign-out');
 const locked=document.getElementById('locked'),desk=document.getElementById('private-desk');
 // View: signed out → viewing → revocation pending/failed → signed out.
 // Local hiding and backend revocation are separate; failed revocation keeps only a retry credential.
 let credential=null,expiry=0,expiryTimer,refreshTimer,freshnessTimer,generation=0,requestSequence=0,revocationPending=false,lastSnapshot=null;
 const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 const random=()=>base64(crypto.getRandomValues(new Uint8Array(32)));
 function hidePrivate(){generation++;requestSequence++;lastSnapshot=null;clearInterval(refreshTimer);clearInterval(freshnessTimer);document.getElementById('calendar-events').replaceChildren();document.getElementById('task-sources').replaceChildren();document.getElementById('snapshot-status').hidden=true;for(const id of ['snapshot-status','calendar-status','tasks-status'])document.getElementById(id).textContent='';desk.hidden=true;locked.hidden=false;}
 function clear(){credential=null;expiry=0;revocationPending=false;clearTimeout(expiryTimer);hidePrivate();signOut.hidden=true;signOut.textContent='Sign out';signIn.hidden=false;}
 async function request(path,options={}){
  const response=await fetch(SERVICE+path,{...options,credentials:'omit',cache:'no-store',headers:{...(credential?{Authorization:'Bearer '+credential}:{}),...options.headers}});
  const body=await response.json();if(!response.ok){const error=Error(response.status===401?'Your session expired. Sign in to continue.':body.error||'Your desk is temporarily unavailable.');error.status=response.status;throw error;}return body;
 }
 const dateTime=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
 const localDay=value=>{const parts={};new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).forEach(p=>parts[p.type]=p.value);return parts.year+'-'+parts.month+'-'+parts.day;};
 function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}
 function calendar(raw){
  const target=document.getElementById('calendar-events'),note=document.getElementById('calendar-status');target.replaceChildren();
  if(!raw||!raw.connected){note.textContent=raw&&raw.error||'Calendar is not connected on the frame.';return;}
  const now=Date.now(),today=localDay(now),end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+7);const endDay=end.toISOString().slice(0,10);
  const compact=value=>value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8)+'T'+value.slice(9,11)+':'+value.slice(11,13)+':'+value.slice(13,15)+'Z';
  const covered=localDay(compact(raw.range_start))<=today&&localDay(compact(raw.range_end))>=endDay;
  const stale=now-Date.parse(raw.retrieved_at)>600000;
  note.textContent='iCloud · '+dateTime(raw.retrieved_at)+(raw.error?' · '+raw.error:stale?' · saved copy may be out of date':'')+(!covered?' · saved coverage does not include the full seven-day window':'');
  const events=raw.events.filter(event=>event.allDay?event.end>today&&event.start<endDay:Date.parse(event.end)>=now&&localDay(event.start)<endDay).sort((a,b)=>a.start.localeCompare(b.start));
  if(!events.length){target.append(node('li',raw.error||stale||!covered?'No appointments in this saved copy for the window. Freshness or coverage is unverified.':'No appointments in the next seven days.'));return;}
  for(const event of events){const item=node('li');item.append(node('strong',event.title||'Untitled appointment'));
   const when=event.allDay?event.start+' · All day':dateTime(event.start)+'–'+new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(event.end));
   item.append(node('span',when+' · '+event.calendar,'companion-note'));if(event.location)item.append(node('span',event.location,'companion-note'));target.append(item);
  }
 }
 function tasks(raw){
  const target=document.getElementById('task-sources'),note=document.getElementById('tasks-status');target.replaceChildren();
  if(!raw||!raw.connected){note.textContent=raw&&raw.error||'Todoist is not connected on the frame.';return;}
  note.textContent=raw.error||'Todoist · view only; manage tasks on your phone or frame.';
  for(const source of raw.sources){const group=node('section'),label=source.kind==='personal'?'Personal':'Assessor';group.append(node('h3',label));
   const stale=!source.updated_at||Date.now()-source.updated_at>180000;
   group.append(node('p',(source.updated_at?dateTime(source.updated_at):'No successful retrieval')+(source.error?' · '+source.error:stale?' · saved tasks may be out of date':''),'companion-note'));
   const list=node('ul');const items=raw.items.filter(item=>item.source===source.kind);
   for(const item of items)list.append(node('li',item.title));
   if(!items.length)list.append(node('li',source.error||stale?'No saved tasks; current source status is unverified.':'No tasks in this source.'));
   group.append(list);target.append(group);
  }
 }
 function renderFreshness(){
  if(!lastSnapshot||desk.hidden||revocationPending)return;
  calendar(lastSnapshot.calendar);tasks(lastSnapshot.tasks);
  const stamp=document.getElementById('snapshot-status');
  stamp.textContent=lastSnapshot.captured_at?'Last frame upload: '+dateTime(lastSnapshot.captured_at)+(Date.now()-lastSnapshot.captured_at>180000?' · Frame may be offline; showing its last saved copy.':' · Updates about once a minute.'):'Waiting for the first frame upload.';
 }
 async function load(){
  const current=generation,sequence=++requestSequence;const data=await request('/api/home');if(current!==generation||sequence!==requestSequence||!credential||Date.now()>=expiry||revocationPending)return;
  lastSnapshot=data;
  locked.hidden=true;desk.hidden=false;signIn.hidden=true;signOut.hidden=false;
  document.getElementById('snapshot-status').hidden=false;renderFreshness();
  status.textContent='Signed in · read-only access.';
 }
 async function refresh(){if(document.hidden||!credential||revocationPending)return;renderFreshness();const current=generation,sequence=requestSequence+1;try{await load();}catch(error){if(current!==generation||sequence!==requestSequence)return;if(error.status===401)clear();status.textContent=error.status===401?error.message:'Web refresh failed. Showing the last loaded copy.';}}
 signIn.addEventListener('click',async()=>{
  signIn.disabled=true;
  try{
   const verifier=random(),nonce=random();
   const challenge=base64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
   sessionStorage.setItem(PROOF_KEY,JSON.stringify({verifier,nonce,at:Date.now()}));
   const url=new URL(SERVICE+'/auth/start');url.searchParams.set('challenge',challenge);url.searchParams.set('nonce',nonce);location.assign(url.href);
  }catch{status.textContent='Sign-in needs temporary browser storage. Check your browser settings and try again.';signIn.disabled=false;}
 });
 signOut.addEventListener('click',async()=>{
  signOut.disabled=true;
  revocationPending=true;hidePrivate();signIn.hidden=true;signOut.textContent='Retry sign out';
  status.textContent='Private view closed. Revoking saved sign-in…';
  try{await request('/api/logout',{method:'POST'});clear();status.textContent='Signed out. Your saved backend session has been revoked.';}
  catch{
   if(!credential||Date.now()>=expiry){clear();status.textContent='Private view closed. Revocation could not be confirmed. Sign in again, then sign out to retry.';}
   else{signOut.hidden=false;status.textContent='Private view closed. Could not revoke saved sign-in. Reconnect and select Retry sign out.';}
  }
  finally{signOut.disabled=false;}
 });
 async function returned(){
  const params=new URLSearchParams(location.hash.slice(1));
  if(!params.has('code'))return;
  // Remove the one-use exchange code before making requests or showing content.
  history.replaceState(null,'',location.pathname+location.search);
  let pending;
  try{pending=JSON.parse(sessionStorage.getItem(PROOF_KEY));sessionStorage.removeItem(PROOF_KEY);}catch{}
  if(!pending||pending.nonce!==params.get('nonce')||Date.now()-pending.at>600000){status.textContent='Sign-in expired. Please try again.';return;}
  signIn.disabled=true;status.textContent='Finishing sign-in…';
  try{
   const result=await request('/auth/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:params.get('code'),verifier:pending.verifier})});
   credential=result.token;expiry=result.expires;
   expiryTimer=setTimeout(()=>{const pending=revocationPending;clear();status.textContent=pending?'Private view closed. Revocation could not be confirmed. Sign in again, then sign out to retry.':'For your privacy, this view has expired. Sign in again to continue; your backend session may still be remembered.';},Math.max(0,expiry-Date.now()));
   await load();refreshTimer=setInterval(refresh,60000);freshnessTimer=setInterval(renderFreshness,30000);
  }catch(error){clear();status.textContent=error.message;}
  finally{signIn.disabled=false;}
 }
 document.getElementById('desk-date').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'long',month:'long',day:'numeric'}).format(new Date());
 document.addEventListener('visibilitychange',()=>{if(credential&&Date.now()>=expiry){const pending=revocationPending;clear();status.textContent=pending?'Private view closed. Revocation could not be confirmed. Sign in again, then sign out to retry.':'Your private viewing session expired. Sign in to continue.';}else if(!document.hidden)refresh();});
 window.addEventListener('pageshow',event=>{if(event.persisted){const pending=revocationPending;clear();status.textContent=pending?'Private view closed. Revocation could not be confirmed. Sign in again, then sign out to retry.':'Sign in to reopen your private desk.';}});
 clear();
 if(new URLSearchParams(location.hash.slice(1)).has('code'))returned();
 else {
  signIn.disabled=true;
  request('/').then(configuration=>{
   signIn.disabled=!configuration.signInConfigured;
   if(!configuration.signInConfigured)status.textContent='Secure sign-in is being configured. No private records are available yet.';
  }).catch(()=>{status.textContent='The private service is unavailable. Reload to try again.';});
 }
})();
