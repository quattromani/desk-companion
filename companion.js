(() => {
 'use strict';
 const SERVICE='https://homehq-desk-companion.homehq-private-desk.workers.dev';
 const PROOF_KEY='desk.pending-sign-in.v1';
 const status=document.getElementById('access-status'),signIn=document.getElementById('sign-in'),signOut=document.getElementById('sign-out');
 const locked=document.getElementById('locked'),desk=document.getElementById('private-desk');
 let credential=null,expiry=0,expiryTimer;
 const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 const random=()=>base64(crypto.getRandomValues(new Uint8Array(32)));
 function clear(){credential=null;expiry=0;clearTimeout(expiryTimer);desk.hidden=true;locked.hidden=false;signOut.hidden=true;signIn.hidden=false;}
 async function request(path,options={}){
  const response=await fetch(SERVICE+path,{...options,credentials:'omit',cache:'no-store',headers:{...(credential?{Authorization:'Bearer '+credential}:{}),...options.headers}});
  const body=await response.json();if(!response.ok)throw Error(response.status===401?'Your session expired. Sign in to continue.':body.error||'Your desk is temporarily unavailable.');return body;
 }
 async function load(){
  await request('/api/home');
  locked.hidden=true;desk.hidden=false;signIn.hidden=true;signOut.hidden=false;
  status.textContent='Signed in · read-only access. Frame data connection is being prepared.';
 }
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
  try{await request('/api/logout',{method:'POST'});clear();status.textContent='Signed out. Your saved backend session has been revoked.';}
  catch{status.textContent='Could not finish signing out. Reconnect and try again to revoke this session.';}
  finally{signOut.disabled=false;}
 });
 async function returned(){
  const params=new URLSearchParams(location.hash.slice(1));
  if(!params.has('code'))return;
  // Remove the one-use exchange code before making requests or showing content.
  history.replaceState(null,'',location.pathname+location.search);
  let pending;
  try{pending=JSON.parse(sessionStorage.getItem(PROOF_KEY));}catch{}
  sessionStorage.removeItem(PROOF_KEY);
  if(!pending||pending.nonce!==params.get('nonce')||Date.now()-pending.at>600000){status.textContent='Sign-in expired. Please try again.';return;}
  signIn.disabled=true;status.textContent='Finishing sign-in…';
  try{
   const result=await request('/auth/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:params.get('code'),verifier:pending.verifier})});
   credential=result.token;expiry=result.expires;
   expiryTimer=setTimeout(()=>{clear();status.textContent='For your privacy, this view has expired. Sign in again to continue; your backend session may still be remembered.';},Math.max(0,expiry-Date.now()));
   await load();
  }catch(error){clear();status.textContent=error.message;}
  finally{signIn.disabled=false;}
 }
 document.getElementById('desk-date').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'long',month:'long',day:'numeric'}).format(new Date());
 window.addEventListener('pageshow',event=>{if(event.persisted){clear();status.textContent='Sign in to reopen your private desk.';}});
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
