/* Motor independente, sem rede ou gravações. Compartilhado com o worker de importação. */
(function(g){
'use strict';
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();
const number=x=>typeof x==='number'?x:x==null||x===''?null:Number(String(x).replace(/R\$/g,'').trim().replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'));
const money=x=>{let s=String(x).toUpperCase().replace(/R\$|\s/g,'');const k=s.endsWith('K');if(k)s=s.slice(0,-1);const n=number(s);return n===null?null:n*(k?1000:1);};
const date=x=>x instanceof Date?`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`:String(x??'').slice(0,10);
const NUM='(?:R\\$\\s*)?\\d[\\d.,]*(?:\\s*K)?';
function ticket(desc){
 let s=norm(desc),m;const out={lo:0,hi:Infinity,li:true,ui:true,source:'Sem limite de ticket informado',uncertain:false};
 let pos=s.search(/\b(?:TKT|TICKET)\b/);if(pos<0){const moneyBound=s.match(/\b(?:ATE|ACIMA\s+DE|A\s+PARTIR\s+DE)\s+(?:R\$\s*\d[\d.,]*|\d[\d.,]*\s*K)\b/);if(!moneyBound)return out;s='TKT '+moneyBound[0];pos=0;}s=s.slice(pos).split('|')[0];
 m=s.match(new RegExp('(?:TKT|TICKET)\\s*(?:>=|>\\s*=|MIN(?:IMO)?|DE)?\\s*('+NUM+')\\s*(?:A|ATE|-)\\s*(?:MAX(?:IMO)?\\s*)?('+NUM+')'));
 if(m){out.lo=money(m[1]);out.hi=money(m[2]);out.source=m[0];return out;}
 m=s.match(new RegExp('(?:TKT|TICKET)\\s*(>=|>\\s*=|>|ACIMA\\s*(?:DE)?|MIN(?:IMO)?\\s*|A\\s*PARTIR\\s*DE|ATE|<=|<)\\s*('+NUM+')'));
 if(m){const op=m[1].replace(/\s/g,'');const n=money(m[2]);out.source=m[0];if(/ATE|</.test(op)){out.hi=n;out.ui=op!=='<';}else{out.lo=n;out.li=!['>','ACIMADE','ACIMA'].includes(op);}return out;}
 // Um ticket isolado não informa se é mínimo ou exato: manter fora do ranking automático.
 if(/\d/.test(s)){out.uncertain=true;out.source='Ticket textual ambíguo: '+s;}
 return out;
}
function grace(desc){const s=norm(desc);if(/SEM\s*CARENCIA/.test(s))return {days:0,source:'Sem carência explícita'};
 let m=s.match(/(?:CARENCIA\s*(?:DE)?\s*|\+\s*)(\d{1,3})\s*(?:D|DIA)/)||s.match(/\b(\d{1,3})\s*(?:DD|D|DIAS)\b/);if(m)return{days:Number(m[1]),source:'Carência extraída da descrição'};
 if(/CARENCIA/.test(s))return{days:null,source:'Carência mencionada sem quantidade de dias'};
 return{days:0,source:'Sem carência por regra definida pelo usuário (não informada)'};
}
function prepare(payload){
 if(!Array.isArray(payload.headers)||!Array.isArray(payload.rows))throw Error('Estrutura da planilha inválida.');
 const headers=payload.headers.map(norm);const col=n=>headers.indexOf(norm(n));
 const required=['Id Regra','Credenciador','Descricao Regra','Prazo De','Prazo Até','Tipo Comissao','Base','Valor'];
 for(const h of required)if(col(h)<0)throw Error('Coluna obrigatória não encontrada: '+h);
 const at=(r,h)=>r[col(h)];const seen=new Map(),conflicts=new Set(),records=[];let invalid=0,duplicates=0;
 for(const r of payload.rows){if(r.every(x=>x==null||x===''))continue;const id=String(at(r,'Id Regra')??'');const fee=number(at(r,'Valor'));const base=String(at(r,'Base')??'');const desc=String(at(r,'Descricao Regra')??'');
 if(!id||!at(r,'Credenciador')||fee===null||!Number.isFinite(fee)||fee<0||(!/FIXO/i.test(base)&&fee>1)){invalid++;continue;}
 const signature=JSON.stringify(r);if(seen.has(id)){if(seen.get(id)!==signature)conflicts.add(id);else duplicates++;continue;}seen.set(id,signature);
 const t=ticket(desc),c=grace(desc);
 records.push({id,bank:String(at(r,'Credenciador')),desc,product:String(at(r,'Produto')??''),operation:String(at(r,'Tipo Proposta')??''),from:number(at(r,'Prazo De'))??0,to:number(at(r,'Prazo Até'))??0,type:String(at(r,'Tipo Comissao')??''),base,fee,table:String(at(r,'Tabela')??''),start:date(at(r,'Data Inicio')),end:date(at(r,'Data Fim')),grossMin:number(at(r,'Valor Bruto De')),grossMax:number(at(r,'Valor Bruto Até')),netMin:number(at(r,'Valor Líquido De')),netMax:number(at(r,'Valor Líquido Até')),rateMin:number(at(r,'Nova Taxa Nominal De')),rateMax:number(at(r,'Nova Taxa Nominal Até')),paidMin:number(at(r,'Percentual de Parcelas Pagas De')),paidMax:number(at(r,'Percentual de Parcelas Pagas Até')),agreement:String(at(r,'Sigla Convenio')??at(r,'Convenio')??''),agreementFull:String(at(r,'Convenio')??''),validityBy:String(at(r,'Vigência por')??''),ticket:t,grace:c,search:norm(desc+' '+at(r,'Credenciador'))});
 }
 const ends={};for(const r of records)if(/^\d{4}-\d{2}-\d{2}$/.test(r.end))ends[r.end]=(ends[r.end]??0)+1;
 const reference=Object.keys(ends).sort((a,b)=>ends[b]-ends[a])[0]||new Date().toISOString().slice(0,10);
 return{records:records.filter(r=>!conflicts.has(r.id)),conflicts:conflicts.size,invalid,duplicates,total:payload.rows.length,reference};
}
function interval(r,f){
 const t={...r.ticket};
 // O valor informado usa a base selecionada. Não presumir líquido = bruto.
 const liquid=/LIQUIDO/.test(norm(f.base));let lo=liquid?r.netMin:r.grossMin,hi=liquid?r.netMax:r.grossMax;
 if(lo!==null&&lo>t.lo){t.lo=lo;t.li=true;}if(hi!==null&&hi>0&&hi<t.hi){t.hi=hi;t.ui=true;}
 return t;
}
function matches(r,f){
 if(f.product && r.product!==f.product)return false;
 if(f.bank&&r.bank!==f.bank||f.agreement&&norm(r.agreement)!==norm(f.agreement)||f.operation&&r.operation!==f.operation||f.base&&r.base!==f.base||f.type&&r.type!==f.type)return false;
 if(f.search&&!r.search.includes(norm(f.search)))return false;
 if(f.date&&((r.start&&r.start>f.date)||(r.end&&r.end<f.date)))return false;
 if(f.term&&(r.from>f.term||r.to<f.term||!r.to))return false;
 if(f.grace!==''&&f.grace!=null&&r.grace.days!==Number(f.grace))return false;
 if(r.ticket.uncertain)return false;
 const t=interval(r,f);
 if(f.amount!=null&&f.amount!==''){const n=Number(f.amount);if(n<t.lo||n>t.hi||n===t.lo&&!t.li||n===t.hi&&!t.ui)return false;}
 if(f.range){const q=f.range;if(f.coverage==='all'){
 if(t.lo>q.lo||t.hi<q.hi||t.lo===q.lo&&!t.li&&q.li||t.hi===q.hi&&!t.ui&&q.ui)return false;
 }else{const low=Math.max(t.lo,q.lo),high=Math.min(t.hi,q.hi);if(low>high)return false;if(low===high&&(!t.li||!t.ui||!q.li||!q.ui))return false;}}
 if(f.rate!=null&&f.rate!==''){const x=Number(f.rate)/100;if(r.rateMin!=null&&x<r.rateMin||r.rateMax!=null&&r.rateMax>0&&x>r.rateMax)return false;}
 if(f.paid!=null&&f.paid!==''){const x=Number(f.paid)/100;if(r.paidMin!=null&&x<r.paidMin||r.paidMax!=null&&x>r.paidMax)return false;}
 return true;
}
function rank(records,f){const rows=records.filter(r=>matches(r,f));rows.sort((a,b)=>b.fee-a.fee||b.start.localeCompare(a.start)||a.bank.localeCompare(b.bank));const banks=new Map();for(const r of rows)if(!banks.has(r.bank))banks.set(r.bank,{...r,alternatives:0});for(const r of rows)banks.get(r.bank).alternatives++;return{rows,banks:[...banks.values()]};}
g.Comissoes={prepare,matches,rank,ticket,grace,norm,interval};
})(globalThis);
