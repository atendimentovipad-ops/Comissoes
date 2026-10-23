importScripts('vendor/xlsx.full.min.js','engine.js');
self.onmessage=async ({data})=>{try{
 let p,partial=false;
 if(data.action==='seed'){postMessage({stage:'Carregando relatório de referência…'});const res=await fetch('seed.json');if(!res.ok)throw Error('Relatório inicial indisponível.');p=await res.json();}
 else{postMessage({stage:'Lendo a planilha no navegador…'});const wb=XLSX.read(data.buffer,{type:'array',cellDates:true});let found;
 for(const name of [...wb.SheetNames].sort((a,b)=>Number(/REGRAS UTILIZADAS/i.test(b))-Number(/REGRAS UTILIZADAS/i.test(a)))){const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:null,raw:true});const i=rows.slice(0,20).findIndex(r=>r.some(v=>Comissoes.norm(v)==='CREDENCIADOR')&&r.some(v=>Comissoes.norm(v)==='ID REGRA'));if(i>=0){found={headers:rows[i],rows:rows.slice(i+1)};partial=/REGRAS UTILIZADAS/i.test(name);break;}}
 if(!found)throw Error('Não encontrei cabeçalho com Id Regra e Credenciador.');p=found;}
 postMessage({stage:'Validando comissões, faixas e carências…'});const result=Comissoes.prepare(p);result.partial=partial;postMessage({result});
}catch(e){postMessage({error:e.message||'Falha na importação.'});}};
