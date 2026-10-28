import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readAuthenticatedSession} from './auth.mjs';
import {readBoundedJSON,SECURITY_HEADERS} from './security.mjs';
import {verifiedOwner,tasteRPC} from './taste.mjs';
const limits=new Map();
const name='chalpick_member_email';
function seal(data,key){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from('chalpick-member-v17'));const encrypted=Buffer.concat([c.update(JSON.stringify(data)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),encrypted]).toString('base64url');}
function unseal(value,key){try{const b=Buffer.from(value,'base64url'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAAD(Buffer.from('chalpick-member-v17'));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]));}catch{return null;}}
export async function handleTasteRegister(request,options={}){
 const reply=(body,status=200,cookie)=>Response.json(body,{status,headers:{...SECURITY_HEADERS,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...(cookie?{'Set-Cookie':cookie}:{})}});
 const env=options.env||process.env,fetchImpl=options.fetchImpl||fetch,now=(options.now||Date.now)();
 try{
  const url=new URL(request.url);
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
  if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('x-chalpick-taste')!=='1'||!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return reply({error:'origin_not_allowed'},403);
  const owner=verifiedOwner((options.readSession||readAuthenticatedSession)(request,options));if(!owner)return reply({error:'not_authenticated'},401);
  const body=await readBoundedJSON(request,4096),action=url.searchParams.get('action');
  const scope=owner.p_provider+':'+owner.p_external_id;
  let limit=limits.get(scope);if(!limit||limit.until<now){if(limits.size>4000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);if(limits.size>4000)return reply({error:'rate_limited'},429);limit={send:0,verify:0,until:now+3600000};limits.set(scope,limit);}
  const key=Buffer.from(env.AUTH_SESSION_SECRET||'','base64url');if(key.length!==32||!env.SUPABASE_PUBLISHABLE_KEY)return reply({error:'not_configured'},503);
  const base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co'))throw new Error('bad_config');
  async function auth(path,payload){const r=await fetchImpl(new URL('/auth/v1/'+path,base),{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(12000)});const data=await readBoundedJSON(r,50000);if(!r.ok)throw new Error('verification_failed');return data;}
  const cookie=(value,maxAge)=>name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(url.protocol==='https:'?'; Secure':'');
  if(action==='send'){
   if(++limit.send>5)return reply({error:'rate_limited'},429);
   if(Object.keys(body).some(k=>k!=='email')||typeof body.email!=='string'||body.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(body.email))return reply({error:'invalid_email'},400);
   const email=body.email.trim().toLowerCase();await auth('otp',{email,create_user:true});
   return reply({status:'sent'},200,cookie(seal({scope,email,exp:now+600000},key),600));
  }
  if(action!=='verify')return reply({error:'not_found'},404);
  if(++limit.verify>12)return reply({error:'rate_limited'},429);
  const raw=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
  const challenge=raw.length===1?unseal(raw[0].slice(name.length+1),key):null;
  if(!challenge||challenge.scope!==scope||challenge.exp<now)return reply({error:'verification_expired'},400);
  if(Object.keys(body).some(k=>!['token','nickname','gender','ageGroup'].includes(k))||!/^\d{6,8}$/.test(body.token||'')||typeof body.nickname!=='string'||body.nickname.trim().length<2||body.nickname.trim().length>20||!['FEMALE','MALE','OTHER'].includes(body.gender)||!['10S','20S','30S','40S','50S_PLUS'].includes(body.ageGroup))return reply({error:'invalid_member_fields'},400);
  const session=await auth('verify',{email:challenge.email,token:body.token,type:'email'}),user=session.user;
  if(!user?.id||user.email?.toLowerCase()!==challenge.email||!user.email_confirmed_at)throw new Error('verification_failed');
  const data=await (options.rpc||tasteRPC)('cp_v17_register_member',{...owner,p_auth_user:user.id,p_email:challenge.email,p_nickname:body.nickname.trim(),p_gender:body.gender,p_age_group:body.ageGroup},options);
  return reply(data,200,cookie('',0));
 }catch(e){return reply({error:e.status?e.message:e.message==='verification_failed'?'verification_failed':'registration_unavailable'},e.status||503);}
}
