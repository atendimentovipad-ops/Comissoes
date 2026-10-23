import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createPortal} from '../server/portal.mjs';
import {corporateEmail,makeSession,sessionToken,sessionCookie} from '../server/security.mjs';
const env={SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-key',SESSION_SECRET:'test-only-secret-abcdefghijklmnopqrstuvwxyz-12345'};
const user={id:'u1',email:'ana@adpromotora.com.br',email_confirmed_at:'2026-10-23T10:00:00Z'};
const origin='https://portal-teste.netlify.app';
let now=1_000_000;
function mockAuth({value=user,fail=false}={}){
 let calls=0;let used=false;
 const fetcher=async(input,init)=>{calls++;const u=new URL(input);assert.equal(u.hostname,'test-project.supabase.co');
 if(fail)throw Error('provider offline');
 if(u.pathname==='/auth/v1/otp')return Response.json({});
 if(u.pathname==='/auth/v1/verify'){const body=JSON.parse(init.body);if(body.token!=='123456'||used)return Response.json({error:'invalid'},{status:401});used=true;return Response.json({access_token:'access-test-only',expires_in:3600});}
 if(u.pathname==='/auth/v1/user')return Response.json(value);
 throw Error('Unexpected network call');};
 return {fetcher,count:()=>calls};
}
function request(path,{method='GET',body,cookie,foreign=false}={}){return new Request(origin+path,{method,headers:{...(method==='POST'?{'Content-Type':'application/json',Origin:foreign?'https://other.example':origin}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});}
function create(auth,more={}){return createPortal({env,fetcher:auth.fetcher,root:process.cwd(),now:()=>now,...more});}
const cookie=()=>sessionCookie(makeSession('access-test-only',3600,env.SESSION_SECRET,now).value,1800);
test('domínio exato, normalização e rejeição de subdomínio/sufixo',()=>{assert.equal(corporateEmail(' Ana@ADPROMOTORA.COM.BR '),user.email);for(const v of ['ana@gmail.com','ana@adpromotora.com.br.evil','ana@sub.adpromotora.com.br','ana@@adpromotora.com.br','ana@adpromotora.com.br\nevil'])assert.equal(corporateEmail(v),null);});
test('tela de login pública sem planilha',async()=>{const a=mockAuth();const r=await create(a)(request('/login'));assert.equal(r.status,200);assert.ok((await r.text()).includes('Código de 6 números'));assert.equal(a.count(),0);});
test('bloqueia painel e dados diretos sem sessão antes de ler arquivos',async()=>{const a=mockAuth();let reads=0;const portal=create(a,{read:async()=>{reads++;throw Error('must not read');}});for(const path of ['/seed.json','/app.js','/private-site/seed.json.gz','/.netlify/functions/portal?resource=seed.json']){const r=await portal(request(path));assert.equal(r.status,401);}assert.equal((await portal(request('/'))).status,302);assert.equal(reads,0);assert.equal(a.count(),0);});
test('e-mail externo é rejeitado antes de solicitar código',async()=>{const a=mockAuth();assert.equal((await create(a)(request('/auth/send',{method:'POST',body:{email:'ana@gmail.com'}}))).status,403);assert.equal(a.count(),0);});
test('envia solicitação corporativa e não devolve token/código',async()=>{const a=mockAuth();const r=await create(a)(request('/auth/send',{method:'POST',body:{email:user.email}}));assert.equal(r.status,200);assert.ok(!(await r.text()).includes('123456'));assert.equal(a.count(),1);});
test('bloqueia origens externas',async()=>{const a=mockAuth();assert.equal((await create(a)(request('/auth/send',{method:'POST',body:{email:user.email},foreign:true}))).status,403);assert.equal(a.count(),0);});
test('código deve ter exatamente seis dígitos',async()=>{const a=mockAuth();for(const code of ['12345','1234567','abcdef'])assert.equal((await create(a)(request('/auth/verify',{method:'POST',body:{email:user.email,code}}))).status,400);assert.equal(a.count(),0);});
test('código inválido não cria sessão',async()=>{const r=await create(mockAuth())(request('/auth/verify',{method:'POST',body:{email:user.email,code:'000000'}}));assert.equal(r.status,401);assert.equal(r.headers.get('set-cookie'),null);});
test('validação consulta identidade confirmada e gera cookie seguro',async()=>{const a=mockAuth();const portal=create(a);const r=await portal(request('/auth/verify',{method:'POST',body:{email:user.email,code:'123456'}}));assert.equal(r.status,200);const c=r.headers.get('set-cookie');for(const flag of ['HttpOnly','Secure','SameSite=Lax','Max-Age=1800'])assert.ok(c.includes(flag));assert.equal(sessionToken(c,env.SESSION_SECRET,now),'access-test-only');assert.equal((await portal(request('/auth/verify',{method:'POST',body:{email:user.email,code:'123456'}}))).status,401);});
test('usuário não confirmado ou de outro domínio é bloqueado após verify',async()=>{for(const value of [{...user,email_confirmed_at:null},{...user,email:'ana@gmail.com'},{...user,email:'outra@adpromotora.com.br'}]){const r=await create(mockAuth({value}))(request('/auth/verify',{method:'POST',body:{email:user.email,code:'123456'}}));assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);}});
test('sessão adulterada e expirada é recusada',async()=>{const a=mockAuth();const good=cookie();assert.equal(sessionToken(good,env.SESSION_SECRET,now+1800001),null);const tampered=good.replace('ad_portal=','ad_portal=X');assert.equal(sessionToken(tampered,env.SESSION_SECRET,now),null);assert.equal((await create(a)(request('/seed.json',{cookie:tampered}))).status,401);});
test('sessão válida acessa app e planilha gzip sem cache público',async()=>{const portal=create(mockAuth());let r=await portal(request('/',{cookie:cookie()}));assert.equal(r.status,200);assert.ok((await r.text()).includes('Radar de condições'));r=await portal(request('/seed.json',{cookie:cookie()}));assert.equal(r.status,200);assert.equal(r.headers.get('content-encoding'),'gzip');assert.ok(r.headers.get('cache-control').includes('no-store'));const data=gunzipSync(Buffer.from(await r.arrayBuffer()));assert.deepEqual(JSON.parse(data),JSON.parse(gunzipSync(await readFile('private-site/seed.json.gz'))));});
test('caminhos não autorizados não são servidos mesmo com sessão',async()=>{const p=create(mockAuth());for(const path of ['/server/security.mjs','/netlify.toml','/private-site/seed.json.gz','/.netlify/functions/portal?resource=../server/security.mjs'])assert.equal((await p(request(path,{cookie:cookie()}))).status,404);});
test('sem configuração e provedor indisponível falham fechados',async()=>{assert.equal((await create(mockAuth(),{env:{}})(request('/seed.json'))).status,503);assert.equal((await create(mockAuth({fail:true}))(request('/seed.json',{cookie:cookie()}))).status,503);});
test('sair remove cookie com origem válida',async()=>{const r=await create(mockAuth())(request('/auth/logout',{method:'POST'}));assert.equal(r.status,200);assert.ok(r.headers.get('set-cookie').includes('Max-Age=0'));});
