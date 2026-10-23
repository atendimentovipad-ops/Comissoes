import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {corporateEmail,config,makeSession,sessionToken,sessionCookie,confirmedUser} from './security.mjs';
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
const ASSETS=new Set(['index.html','style.css','app.js','engine.js','import-worker.js','vendor/xlsx.full.min.js','seed.json','session.js']);
const baseHeaders={'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Netlify-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin'};
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{...baseHeaders,'Content-Type':'application/json; charset=utf-8',...headers}});
const redirect=(to,headers={})=>new Response(null,{status:302,headers:{...baseHeaders,Location:to,...headers}});
export function createPortal({env=process.env,fetcher=fetch,read=readFile,root=process.cwd(),now=()=>Date.now()}={}) {
 return async(request)=>{
  const url=new URL(request.url);
  let path=url.pathname;
  if(path.startsWith('/.netlify/functions/portal'))path='/'+(url.searchParams.get('resource')||'');
  if(path==='//')path='/';
  const method=request.method;
  if(!['GET','HEAD','POST'].includes(method))return json({error:'Método não permitido.'},405);
  try {
   if(method==='GET' && (path==='/auth/login.js'||path==='/auth/login.css')) {
    const name=path.endsWith('.js')?'login.js':'login.css';
    return new Response(await read(join(root,'server',name)),{headers:{...baseHeaders,'Content-Type':name.endsWith('.js')?TYPES['.js']:TYPES['.css']}});
   }
   if(path.startsWith('/auth/') && method==='POST') {
    if(request.headers.get('origin')!==url.origin)return json({error:'Origem não permitida.'},403);
    if(path==='/auth/logout')return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
    if(!['/auth/send','/auth/verify'].includes(path))return json({error:'Rota não encontrada.'},404);
    const cfg=config(env);
    const raw=await request.text();if(raw.length>2048)return json({error:'Solicitação inválida.'},413);
    let body;try{body=JSON.parse(raw);}catch{return json({error:'Solicitação inválida.'},400);}
    const email=corporateEmail(body.email);
    if(!email)return json({error:'Use um e-mail do domínio @adpromotora.com.br.'},403);
    if(path==='/auth/send') {
     const res=await fetcher(cfg.url+'/auth/v1/otp',{method:'POST',headers:{apikey:cfg.key,'Content-Type':'application/json'},body:JSON.stringify({email,create_user:true}),signal:AbortSignal.timeout(10000)});
     if(!res.ok)return json({error:res.status===429?'Aguarde antes de solicitar outro código.':'Não foi possível enviar o código. Verifique o envio de e-mails da autenticação.'},res.status===429?429:502);
     return json({ok:true,message:'Código solicitado. Confira seu e-mail corporativo.'});
    }
    if(typeof body.code!=='string'||!/^\d{6}$/.test(body.code))return json({error:'Informe os 6 números do código.'},400);
    const res=await fetcher(cfg.url+'/auth/v1/verify',{method:'POST',headers:{apikey:cfg.key,'Content-Type':'application/json'},body:JSON.stringify({email,token:body.code,type:'email'}),signal:AbortSignal.timeout(10000)});
    if(!res.ok)return json({error:res.status===429?'Muitas tentativas. Aguarde antes de tentar novamente.':'Código inválido ou expirado.'},res.status===429?429:401);
    const session=await res.json();
    const user=await confirmedUser(session.access_token,cfg,fetcher);
    if(!user||corporateEmail(user.email)!==email)return json({error:'Acesso corporativo não confirmado.'},403);
    const signed=makeSession(session.access_token,session.expires_in,cfg.secret,now());
    return json({ok:true},200,{'Set-Cookie':sessionCookie(signed.value,signed.age)});
   }
   if(!['GET','HEAD'].includes(method))return json({error:'Método não permitido.'},405);
   if(path==='/login')return new Response(method==='HEAD'?null:await read(join(root,'server','login.html')),{headers:{...baseHeaders,'Content-Type':TYPES['.html'],'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
   const cfg=config(env);
   const token=sessionToken(request.headers.get('cookie'),cfg.secret,now());
   const user=await confirmedUser(token,cfg,fetcher);
   if(!user) return path==='/'||request.headers.get('accept')?.includes('text/html')?redirect('/login',{'Set-Cookie':sessionCookie('',0)}):json({error:'Autenticação corporativa obrigatória.'},401);
   const name=path==='/'?'index.html':path.slice(1);
   if(!ASSETS.has(name))return json({error:'Arquivo não encontrado.'},404);
   if(name==='seed.json') {
    const bytes=await read(join(root,'private-site','seed.json.gz'));
    return new Response(method==='HEAD'?null:bytes,{headers:{...baseHeaders,'Content-Type':TYPES['.json'],'Content-Encoding':'gzip','Vary':'Accept-Encoding, Cookie'}});
   }
   const ext='.'+name.split('.').pop();
   return new Response(method==='HEAD'?null:await read(join(root,'private-site',name)),{headers:{...baseHeaders,'Content-Type':TYPES[ext]||'application/octet-stream'}});
  }catch {return json({error:'Acesso indisponível. Verifique as configurações de autenticação no servidor ou tente novamente.'},503);}
 };
}
