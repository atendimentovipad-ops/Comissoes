const $=id=>document.getElementById(id);
let email='',busy=false,nextSend=0;
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function controls(active){busy=active;for(const id of ['send','verify','resend','change'])$(id).disabled=active;}
async function api(path,body){const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let data;try{data=await r.json();}catch{throw Error('Não foi possível conectar ao portal. Tente novamente.');}if(!r.ok)throw Error(data.error||'Não foi possível concluir.');return data;}
async function send(){if(busy)return;if(Date.now()<nextSend){message('Aguarde um minuto entre solicitações de código.',true);return;}controls(true);message('Solicitando código…');try{await api('/auth/send',{email});nextSend=Date.now()+60000;$('email-form').hidden=true;$('code-form').hidden=false;$('destination').textContent='Informe o código enviado para '+email+'.';message('Confira também a pasta de spam.');$('code').focus();}catch(e){message(e.message,true);}finally{controls(false);}}
$('email-form').addEventListener('submit',e=>{e.preventDefault();email=$('email').value.trim().toLowerCase();if(!/^[^@\s]+@adpromotora\.com\.br$/.test(email)){message('Informe seu e-mail @adpromotora.com.br.',true);return;}void send();});
$('code-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;const code=$('code').value.trim();if(!/^\d{6}$/.test(code)){message('Digite os 6 números do código.',true);return;}controls(true);message('Validando acesso…');try{await api('/auth/verify',{email,code});location.replace('/');}catch(e){message(e.message,true);$('code').select();}finally{controls(false);}});
$('resend').addEventListener('click',()=>void send());
$('change').addEventListener('click',()=>{$('code-form').hidden=true;$('email-form').hidden=false;$('code').value='';message('');$('email').focus();});
