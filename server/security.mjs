import { createHmac, timingSafeEqual } from 'node:crypto';
export const DOMAIN='adpromotora.com.br';
export const COOKIE='__Host-ad_portal';
export function corporateEmail(value) {
 if(typeof value!=='string') return null;
 const email=value.trim().toLowerCase();
 return email.length<=254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@adpromotora\.com\.br$/.test(email) && email.split('@').length===2 ? email : null;
}
export function config(env=process.env) {
 const url=env.SUPABASE_URL || '';
 const key=env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) || !key || key.includes('SUA_') || !env.SESSION_SECRET || env.SESSION_SECRET.length<32 || env.SESSION_SECRET.startsWith('GERE_')) throw Error('Configuração de autenticação pendente no servidor.');
 return {url:url.replace(/\/$/,''),key,secret:env.SESSION_SECRET};
}
function signature(body,secret){return createHmac('sha256',secret).update(body).digest('base64url');}
export function makeSession(accessToken,expiresIn,secret,now=Date.now()) {
 const age=Math.min(1800,Number(expiresIn));
 if(!Number.isFinite(age)||age<=0||typeof accessToken!=='string'||accessToken.length>5000)throw Error('Sessão inválida.');
 const data=Buffer.from(JSON.stringify({token:accessToken,expires:now+age*1000})).toString('base64url');
 return {value:data+'.'+signature(data,secret),age:Math.floor(age)};
}
export function sessionToken(cookie,secret,now=Date.now()) {
 try {
 const entry=String(cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 const value=entry?.slice(COOKIE.length+1)||'';
 if(value.length>8000)return null;
 const [body,sig,...rest]=value.split('.');if(!body||!sig||rest.length)return null;
 const a=Buffer.from(signature(body,secret)),b=Buffer.from(sig);
 if(a.length!==b.length||!timingSafeEqual(a,b))return null;
 const data=JSON.parse(Buffer.from(body,'base64url').toString());
 return Number.isFinite(data.expires)&&data.expires>now&&typeof data.token==='string'?data.token:null;
 }catch{return null;}
}
export const sessionCookie=(value,age)=>`${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;
export async function confirmedUser(token,cfg,fetcher=fetch){
 if(!token)return null;
 const res=await fetcher(cfg.url+'/auth/v1/user',{headers:{apikey:cfg.key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
 if(!res.ok)return null;
 const user=await res.json();
 return user.id && user.email_confirmed_at && corporateEmail(user.email)?user:null;
}
