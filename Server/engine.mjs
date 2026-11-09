import {createHash} from 'node:crypto';
import {decodeDocument} from './schema.mjs';

export const columns = {
  Objekte:['ObjektID','Bezeichnung','Verwaltungsart','Adresse','Straße','Hausnummer','PLZ','Ort','Status'],
  Einheiten:['EinheitID','ObjektID','Lage','Wohnfläche','MEA'],
  Kreditoren:['KreditorID','Name','Adresse','USt-ID','IBAN','Status','Angelegt am'],
  Rechnungen:['RechnungID','KreditorID','ObjektID','Rechnungsnummer','Belegart','Datum','Netto','USt','Brutto','Fälligkeit','Status','Währung','Rechendifferenz','Prüfhinweis','PDF_SHA256'],
  Rechnungspositionen:['PositionID','RechnungID','Beschreibung','Menge','Einheit','Einzelpreis','Gesamt netto','USt-Satz','Kategorie'],
  Audit_Log:['AuditID','Zeitpunkt','Mail-Konto','Mail-ID','Mail-Datum','Absender','Betreff','Dateiname','Ergebnis','RechnungID','KreditorID','ObjektID','Kreditor','Rechnungsnummer','Belegart','Datum','Netto','USt','Brutto','Verbrauchsstelle','Kreditorabgleich','Fehlende Pflichtfelder','Probleme','Prüfhinweis','Manuell prüfen','PDF_SHA256','Modell','Input-Token','Output-Token','Antwortdatei']
};
export const hash = value => createHash('sha256').update(value).digest('hex');
const clean = value => typeof value === 'string' ? value.trim() : '';
const norm = value => clean(String(value ?? '')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9]/g,'');
const idnorm = value => clean(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
const invoiceNorm = value => clean(value).toUpperCase().replace(/\s/g,'');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const cents = value => Math.sign(value)*Math.round((Math.abs(value)+Number.EPSILON)*100);
const money = value => finite(value) ? cents(value)/100 : null;
export const emptyLedger = () => Object.fromEntries(Object.keys(columns).map(name=>[name,[]]));

export function validIban(value) {
  const iban=idnorm(value);
  if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved=iban.slice(4)+iban.slice(0,4);
  let mod=0;
  for(const character of moved){for(const digit of /[A-Z]/.test(character)?String(character.charCodeAt(0)-55):character) mod=(mod*10+Number(digit))%97;}
  return mod===1;
}
function validDate(value) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value??'')) return false;
  const date=new Date(value+'T12:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10)===value;
}

export function parseClaude(response) {
  if(response?.error) throw Error('Claude API: '+(response.error.message??response.error.type??'Anfrage fehlgeschlagen'));
  if(response?.stop_reason && !['end_turn','stop_sequence'].includes(response.stop_reason)) throw Error('Claude-Antwort unvollständig oder abgelehnt: '+response.stop_reason);
  let raw = typeof response==='string' ? response : Array.isArray(response?.content) ? response.content.filter(b=>b.type==='text').map(b=>b.text??'').join('\n') : null;
  if(raw===null && response && typeof response==='object' && 'belegart' in response) return {value:response,recovered:false};
  if(!raw?.trim()) throw Error('Claude-Antwort enthält keinen lesbaren JSON-Text.');
  raw=raw.replace(/^\uFEFF/,'').trim();
  try {const value=JSON.parse(raw); if(value&&typeof value==='object'&&!Array.isArray(value)) return {value,recovered:false};} catch {}
  const candidates=[];
  let start=-1,depth=0,inString=false,escaped=false;
  for(let i=0;i<raw.length;i++){
    const c=raw[i];
    if(start<0){if(c==='{'){start=i;depth=1;inString=false;escaped=false;}continue;}
    if(inString){if(escaped) escaped=false;else if(c==='\\') escaped=true;else if(c==='"') inString=false;continue;}
    if(c==='"') inString=true;
    else if(c==='{')depth++;
    else if(c==='}'&&--depth===0){try{const value=JSON.parse(raw.slice(start,i+1));if(value&&typeof value==='object'&&'belegart'in value)candidates.push(value);}catch{}start=-1;}
  }
  if(candidates.length!==1) throw Error(candidates.length>1?'Mehrere JSON-Belege in einer Antwort; keine eindeutige Zuordnung.':'Claude-Antwort ist kein lesbares Beleg-JSON.');
  return {value:candidates[0],recovered:true};
}

function checkSchema(value) {
  if(!value || !['Rechnung','Gutschrift','Abrechnung','Sonstiges'].includes(value.belegart)) throw Error('JSON-Schema: belegart fehlt oder ist ungültig.');
  if(!value.kreditor || typeof value.kreditor!=='object'||Array.isArray(value.kreditor)) throw Error('JSON-Schema: kreditor muss ein Objekt sein.');
  for(const key of ['verbrauchsstellen','positionen','hinweise']) if(!Array.isArray(value[key])) throw Error('JSON-Schema: '+key+' muss eine Liste sein.');
  const check=(obj,strings,numbers)=>{
    for(const key of strings) if(!(key in obj)|| !(obj[key]===null||typeof obj[key]==='string')) throw Error('JSON-Schema: '+key+' erwartet Text oder null.');
    for(const key of numbers) if(!(key in obj)||!(obj[key]===null||finite(obj[key]))) throw Error('JSON-Schema: '+key+' erwartet Zahl oder null.');
  };
  check(value,['rechnungsnummer','datum','faelligkeit','waehrung','rechnungsadresse'],['netto','ust','brutto']);
  check(value.kreditor,['name','adresse','ust_id','iban'],[]);
  for(const key of ['faelligkeit_tage','skonto_prozent','lohnanteil_35a','abschlaege_brutto','zahlbetrag'])if(key in value&&value[key]!==null&&!finite(value[key]))throw Error('JSON-Schema: '+key+' erwartet Zahl oder null.');
  for(const key of ['zahlungsbedingungen','leistungszeitraum','bezug_rechnungsnummer'])if(key in value&&value[key]!==null&&typeof value[key]!=='string')throw Error('JSON-Schema: '+key+' erwartet Text oder null.');
  for(const site of value.verbrauchsstellen){if(!site||typeof site!=='object')throw Error('JSON-Schema: Verbrauchsstelle ungültig.');check(site,['strasse','hausnummer','plz','ort','bezeichnung','belegstelle'],[]);}
  for(const line of value.positionen){if(!line||typeof line!=='object')throw Error('JSON-Schema: Position ungültig.');check(line,['beschreibung','einheit','kategorie'],['menge','einzelpreis','gesamt_netto','ust_satz']);}
  if(value.hinweise.some(v=>typeof v!=='string'))throw Error('JSON-Schema: hinweise erwartet Texte.');
}
function street(value){return norm(value).replace(/strasse$/,'str');}
function objectAddress(row){
  if(row['Straße']&&row.Hausnummer)return {strasse:row['Straße'],hausnummer:String(row.Hausnummer),plz:String(row.PLZ??''),ort:row.Ort};
  const full=clean(row.Adresse).replace(/\n/g,', ');
  const match=full.match(/^(.+?)\s+(\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?)[,\s]+(\d{5})\s+(.+)$/i);
  return match?{strasse:match[1],hausnummer:match[2],plz:match[3],ort:match[4]}:null;
}
export function matchObject(sites,objects) {
  if(!sites.length)return {error:'Keine ausdrücklich ausgewiesene Objekt- oder Verbrauchsstelle gefunden. Rechnungsadresse nicht zur Zuordnung verwenden.'};
  const matched=[];
  for(const site of sites){
    if(!clean(site.belegstelle)||!site.strasse||!site.hausnummer||(!site.plz&&!site.ort)) return {error:'Verbrauchsstelle unvollständig; Straße, Hausnummer und PLZ oder Ort am Beleg prüfen.'};
    const matches=objects.filter(row=>{
      if(row.Status && norm(row.Status)!=='aktiv')return false;
      const address=objectAddress(row);
      if(!address||(!address.plz&&!address.ort))return false;
      return street(site.strasse)===street(address.strasse)&&norm(site.hausnummer)===norm(address.hausnummer)
        &&(!site.plz||!address.plz||norm(site.plz)===norm(address.plz))
        &&(!site.ort||!address.ort||norm(site.ort)===norm(address.ort))
        &&((site.plz&&address.plz)||(site.ort&&address.ort));
    });
    if(matches.length!==1)return {error:matches.length?'Mehrere bekannte Objekte passen zur Verbrauchsstelle.':'Verbrauchsstelle keinem aktiven, vollständig erfassten Objekt zugeordnet.'};
    matched.push(matches[0]);
  }
  if(new Set(matched.map(r=>r.ObjektID)).size!==1)return {error:'Beleg umfasst mehrere Objekte; vor Erfassung manuell aufteilen.'};
  return {row:matched[0]};
}

function resolveVendor(supplier,rows,now){
  const name=clean(supplier.name),uid=idnorm(supplier.ust_id),iban=idnorm(supplier.iban);
  const problems=[];
  const uidValid=/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(uid);
  const ibanValid=validIban(iban);
  if(uid&&!uidValid)problems.push('USt-ID hat ein ungültiges Format; am Original prüfen.');
  if(iban&&!ibanValid)problems.push('IBAN-Prüfziffer oder Format ungültig; Bankverbindung am Original prüfen.');
  const byUid=uidValid?rows.filter(r=>idnorm(r['USt-ID'])===uid):[];
  const byIban=ibanValid?rows.filter(r=>idnorm(r.IBAN)===iban):[];
  const strong=[...new Map([...byUid,...byIban].map(r=>[r.KreditorID,r])).values()];
  if(strong.length>1)return {error:'USt-ID und IBAN führen zu mehreren Kreditoren. Stammdaten zusammenführen oder Zuordnung korrigieren.',problems};
  if(strong.length){
    const row=strong[0];
    if(uidValid&&row['USt-ID']&&idnorm(row['USt-ID'])!==uid)return {error:'IBAN passt, aber USt-ID widerspricht dem bestehenden Kreditor. Nicht automatisch zusammenführen.',problems};
    if(ibanValid&&row.IBAN&&idnorm(row.IBAN)!==iban)problems.push('Abweichende IBAN bei bestehendem Kreditor. Vor einer Zahlung Bankverbindung unabhängig bestätigen. Stammdaten wurden nicht geändert.');
    if(name&&norm(row.Name)!==norm(name))problems.push('Kreditorname weicht bei gleicher USt-ID oder IBAN ab; Namen am Beleg prüfen.');
    return {row,method:byUid.length?'USt-ID':'IBAN',problems};
  }
  const sameName=name?rows.filter(r=>norm(r.Name)===norm(name)):[];
  if(sameName.length>1)return {error:'Mehrere Kreditoren haben denselben Namen. Keine automatische Neuanlage oder Auswahl.',problems};
  if(sameName.length){
    const row=sameName[0];
    if((uidValid&&row['USt-ID']&&idnorm(row['USt-ID'])!==uid)||(ibanValid&&row.IBAN&&idnorm(row.IBAN)!==iban))return {error:'Kreditorname passt, USt-ID oder IBAN widersprechen den Stammdaten. Dublettenverdacht prüfen.',problems};
    problems.push('Kreditor nur über den Namen gefunden; USt-ID und IBAN manuell abgleichen.');
    return {row,method:'Name',problems};
  }
  const words=value=>new Set(clean(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(word=>word.length>2&&!['gmbh','und','kg','co'].includes(word)));
  const tokens=words(name);
  const similarNames=rows.filter(row=>{const other=words(row.Name);const common=[...tokens].filter(word=>other.has(word)).length;return common>0&&common/Math.max(tokens.size,other.size)>=0.8;});
  if(similarNames.length)return {error:'Ähnlicher Kreditorname bereits vorhanden. USt-ID oder IBAN für eine sichere Zuordnung ergänzen; keine automatische Neuanlage.',problems};
  if(!name)return {error:'Kreditorname fehlt; keine eindeutige Neuanlage möglich.',problems};
  problems.push('Kreditor neu angelegt; Firmenname, Adresse, USt-ID und IBAN vor Freigabe prüfen.');
  return {row:{KreditorID:'K-'+hash(uidValid?uid:ibanValid?iban:norm(name)).slice(0,16),Name:name,Adresse:clean(supplier.adresse),Strasse:clean(supplier.strasse),PLZ:clean(supplier.plz),Ort:clean(supplier.ort),Steuernummer:clean(supplier.steuernummer),'USt-ID':uidValid?uid:'',IBAN:ibanValid?iban:'',Status:'zu prüfen','Angelegt am':now},method:'Neu',isNew:true,problems};
}

export function processDocument(event,ledger,{now=new Date().toISOString(),tolerance=0.02}={}){
  const meta=event.meta??{}, pdfHash=event.pdfHash??'', response=event.response;
  const sourceId=clean(meta.messageId)?meta.messageId:meta.submittedAt??'';
  const sourceKey=[meta.mailbox??'Manueller Upload',sourceId,meta.attachmentIndex??0,meta.filename??'',pdfHash].join('|');
  const auditId='A-'+hash(sourceKey).slice(0,24);
  const prior=ledger.Audit_Log.find(row=>row.AuditID===auditId);
  if(prior&&!['Fehler','Objekt unbekannt'].includes(prior.Ergebnis))return {audit:prior,invoices:[],positions:[],vendors:[],idempotent:true};
  const problems=[],hints=[],missing=[],derived=[],calculationProblems=[];
  const calculationProblem=message=>{calculationProblems.push(message);problems.push(message);};
  const audit={AuditID:auditId,Zeitpunkt:now,'Mail-Konto':meta.mailbox??'Manueller Upload','Mail-ID':sourceId,'Mail-Datum':meta.date??'',Absender:meta.from??'',Betreff:meta.subject??'',Dateiname:meta.filename??'',Ergebnis:'Fehler',RechnungID:'',KreditorID:'',ObjektID:'',Kreditor:'',Rechnungsnummer:'',Belegart:'',Datum:'',Netto:null,USt:null,Brutto:null,Verbrauchsstelle:'',Kreditorabgleich:'','Fehlende Pflichtfelder':'',Probleme:'',Prüfhinweis:'','Manuell prüfen':'Nein',PDF_SHA256:pdfHash,Modell:response?.model??'', 'Input-Token':response?.usage?.input_tokens??null,'Output-Token':response?.usage?.output_tokens??null,Antwortdatei:event.evidenceFile??''};
  const result={audit,invoices:[],positions:[],vendors:[],replaceAudit:!!prior};
  audit.Auslesemodus=event.mode??'Claude API';
  const finish=(outcome,extraHint='')=>{
    audit.Ergebnis=outcome;
    audit['Fehlende Pflichtfelder']=[...new Set(missing)].join('; ');
    audit.Probleme=[...new Set(problems)].join('; ');
    audit.Prüfhinweis=[...new Set([...hints,extraHint].filter(Boolean))].join(' ');
    audit['Manuell prüfen']=(problems.length||missing.length||audit.Prüfhinweis)?'Ja':'Nein';
    return result;
  };
  if(event.error){problems.push(clean(event.error));return finish('Fehler','PDF oder API-Verbindung prüfen und Beleg anschließend gezielt erneut verarbeiten.');}
  let value;
  try{const parsed=parseClaude(response);value=decodeDocument(parsed.value);checkSchema(value);if(parsed.recovered){problems.push('JSON erst aus Vorrede oder Codeblock extrahiert.');hints.push('Ausgelesene Werte mit dem PDF vergleichen.');}}
  catch(error){problems.push(error.message);return finish('Fehler','Gespeicherte Claude-Antwort und Original-PDF prüfen; keine Rechnungsdaten wurden geschrieben.');}
  const doc=value;
  audit.Kreditor=clean(doc.kreditor.name);audit.Rechnungsnummer=clean(doc.rechnungsnummer);audit.Belegart=doc.belegart;audit.Datum=doc.datum??'';
  audit.Netto=doc.netto;audit.USt=doc.ust;audit.Brutto=doc.brutto;audit['Währung']=clean(doc.waehrung).toUpperCase();
  audit.Verbrauchsstelle=doc.verbrauchsstellen.map(s=>[s.strasse,s.hausnummer,s.plz,s.ort].filter(Boolean).join(' ')+' ['+(s.belegstelle??'')+']').join('; ');
  for(const warning of doc.hinweise.filter(clean)){problems.push(warning);hints.push('Auslesehinweise am Original-PDF prüfen.');}
  if(doc.belegart==='Sonstiges')return finish('kein Beleg');
  const match=matchObject(doc.verbrauchsstellen,ledger.Objekte);
  if(!match.row){problems.push(match.error);return finish('Objekt unbekannt','Objekt- bzw. Verbrauchsstelle am PDF mit der Objektliste abgleichen; Rechnungsadresse der Verwaltung nicht übernehmen.');}
  audit.ObjektID=match.row.ObjektID;
  for(const [name,val] of [['Rechnungsnummer',doc.rechnungsnummer],['Kreditorname',doc.kreditor.name],['Kreditoradresse',doc.kreditor.adresse],['Währung',doc.waehrung]])if(!clean(val))missing.push(name);
  if(!validDate(doc.datum))missing.push('Datum');
  const credit=doc.belegart==='Gutschrift';
  let due=doc.faelligkeit,dueOrigin=validDate(due)?'Datum auf Beleg':'';
  // A single explicitly announced direct-debit date is a traceable payment date.
  // Do not guess when payment terms contain multiple distinct dates.
  if(!validDate(due)&&!credit&&/lastschrift|abbuch|buchen/i.test(doc.zahlungsbedingungen??'')){
    const dates=[...new Set((doc.zahlungsbedingungen.match(/\b(?:\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\b/g)??[]).map(value=>/^\d{2}\./.test(value)?value.split('.').reverse().join('-'):value).filter(validDate))];
    if(dates.length===1){due=dates[0];dueOrigin='Angekündigtes Lastschriftdatum aus Zahlungsbedingungen';derived.push('Fälligkeit: '+dueOrigin);}
  }
  if(!validDate(due)&&validDate(doc.datum)&&Number.isInteger(doc.faelligkeit_tage)&&doc.faelligkeit_tage>=0&&doc.faelligkeit_tage<=365&&clean(doc.zahlungsbedingungen)){
    const date=new Date(doc.datum+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+doc.faelligkeit_tage);due=date.toISOString().slice(0,10);dueOrigin='Rechnungsdatum + '+doc.faelligkeit_tage+' Tage ('+doc.zahlungsbedingungen+')';derived.push('Fälligkeit: '+dueOrigin);
  }
  if(!validDate(due)&&!credit)missing.push('Fälligkeit');
  for(const name of ['ust','brutto'])if(!finite(doc[name]))missing.push(name);
  if(doc.waehrung&&doc.waehrung.toUpperCase()!=='EUR'){problems.push('Belegwährung ist nicht EUR; Beträge werden nicht umgerechnet.');hints.push('Belegwährung und Erfassung in der Buchhaltung prüfen.');}
  const header={netto:money(doc.netto),ust:money(doc.ust),brutto:money(doc.brutto)};
  if(credit){for(const key of Object.keys(header))if(header[key]!==null)header[key]=-Math.abs(header[key]);}
  const lines=structuredClone(doc.positionen);
  if(!lines.length)missing.push('Rechnungspositionen');
  const rawSum=lines.reduce((sum,line)=>sum+(finite(line.gesamt_netto)?line.gesamt_netto:0),0);
  const lineFactor=credit&&rawSum>0?-1:1;
  let lineSum=0,allLineNet=true,allRates=true;
  const vatGroups=new Map();
  for(let i=0;i<lines.length;i++){
    const line=lines[i],label='Position '+(i+1);
    if(!clean(line.beschreibung))missing.push(label+' Beschreibung');
    for(const key of ['menge','einzelpreis','gesamt_netto','ust_satz'])if(!finite(line[key]))missing.push(label+' '+key);
    if(finite(line.ust_satz)&&(line.ust_satz<0||line.ust_satz>100))calculationProblem(label+': USt-Satz liegt außerhalb von 0 bis 100 Prozent.');
    if(!clean(line.einheit))missing.push(label+' Einheit');
    if(finite(line.gesamt_netto)){line.gesamt_netto=money(line.gesamt_netto*lineFactor);lineSum+=cents(line.gesamt_netto);}else allLineNet=false;
    if(finite(line.einzelpreis))line.einzelpreis*=lineFactor;
    if(finite(line.ust_satz)&&line.ust_satz>=0&&line.ust_satz<=100&&finite(line.gesamt_netto))vatGroups.set(line.ust_satz,(vatGroups.get(line.ust_satz)??0)+cents(line.gesamt_netto));else allRates=false;
    if(finite(line.menge)&&finite(line.einzelpreis)&&finite(line.gesamt_netto)&&Math.abs(cents(line.menge*line.einzelpreis)-cents(line.gesamt_netto))>cents(tolerance))calculationProblem(label+': Menge × Einzelpreis stimmt nicht mit Gesamt netto überein.');
  }
  const exceeds=diff=>Math.abs(diff)>cents(tolerance);
  let netOrigin=header.netto!==null?'Gesamtnetto auf Beleg':'';
  if(header.netto===null&&allLineNet&&lines.length){header.netto=lineSum/100;netOrigin='Summe aller Nettopositionen einschließlich nicht umsatzsteuerbarer Leistungen';derived.push('Netto: '+netOrigin);}
  if(header.netto===null)missing.push('netto');
  const difference=allLineNet&&header.brutto!==null&&header.ust!==null?(lineSum+cents(header.ust)-cents(header.brutto))/100:null;
  if(allLineNet&&header.netto!==null&&exceeds(lineSum-cents(header.netto)))calculationProblem('Summe der Nettopositionen weicht vom ausgewiesenen Netto ab.');
  if(header.netto!==null&&header.ust!==null&&header.brutto!==null&&exceeds(cents(header.netto)+cents(header.ust)-cents(header.brutto)))calculationProblem('Netto + USt entspricht nicht dem Brutto.');
  if(difference!==null&&exceeds(cents(difference)))calculationProblem('Nettopositionen + USt entspricht nicht dem Brutto.');
  const vatSum=[...vatGroups].reduce((sum,[rate,net])=>sum+Math.sign(net)*Math.round(Math.abs(net)*rate/100+1e-8),0);
  if(allLineNet&&allRates&&header.ust!==null&&exceeds(vatSum-cents(header.ust)))calculationProblem('Aus den USt-Sätzen der Positionen berechnete Steuer weicht von USt ab.');
  if(!credit&&header.brutto!==null&&header.brutto<0)problems.push('Rechnung mit negativem Brutto; Belegart prüfen.');
  const paid=finite(doc.abschlaege_brutto)?Math.abs(money(doc.abschlaege_brutto)):null;
  const payable=finite(doc.zahlbetrag)?(credit?-Math.abs(money(doc.zahlbetrag)):money(doc.zahlbetrag)):null;
  if(paid!==null&&payable!==null&&header.brutto!==null&&exceeds(cents(header.brutto)-cents(paid)-cents(payable)))calculationProblem('Gesamtbrutto minus geleistete Abschläge entspricht nicht dem Zahlbetrag.');
  if(calculationProblems.length)hints.push('Nettopositionen, Steuersätze und Belegsummen am PDF nachrechnen; Rechnung bis zur Klärung nicht freigeben.');
  if(missing.length)hints.push('Fehlende oder ungültige Pflichtfelder am Original ergänzen: '+[...new Set(missing)].join(', ')+'.');
  audit.Netto=header.netto;audit.USt=header.ust;audit.Brutto=header.brutto;audit.Abschlaege_brutto=paid;audit.Zahlbetrag=payable;audit.Herleitungen=derived.join('; ');audit.Auslesemodus=event.mode??'Claude API';
  const vendor=resolveVendor(doc.kreditor,ledger.Kreditoren,now);
  problems.push(...vendor.problems);
  if(vendor.error){problems.push(vendor.error);return finish('Fehler','Kreditorzuordnung und mögliche Stammdatendubletten manuell klären.');}
  audit.KreditorID=vendor.row.KreditorID;audit.Kreditorabgleich=vendor.method;
  if(vendor.isNew||vendor.method==='Name')hints.push('Kreditorstammdaten und Bankverbindung vor Freigabe kontrollieren.');
  const number=invoiceNorm(doc.rechnungsnummer);
  const duplicates=number?ledger.Rechnungen.filter(r=>r.KreditorID===vendor.row.KreditorID&&invoiceNorm(r.Rechnungsnummer)===number):[];
  const samePdf=pdfHash?ledger.Rechnungen.filter(r=>r.PDF_SHA256===pdfHash):[];
  const similar=number?ledger.Rechnungen.filter(r=>r.KreditorID===vendor.row.KreditorID&&idnorm(r.Rechnungsnummer)===idnorm(doc.rechnungsnummer)&&invoiceNorm(r.Rechnungsnummer)!==number):[];
  if(duplicates.length||samePdf.length||similar.length){
    const existing=duplicates[0]??samePdf[0]??similar[0];audit.RechnungID=existing.RechnungID;
    if(similar.length&&!duplicates.length){problems.push('Dublettenverdacht: Rechnungsnummer unterscheidet sich nur durch Satzzeichen.');hints.push('Vorhandenen Beleg '+existing.RechnungID+' mit dem neuen PDF vergleichen.');}
    if(header.brutto!==null&&finite(existing.Brutto)&&cents(header.brutto)!==cents(existing.Brutto)){problems.push('Gleicher Kreditor und gleiche Rechnungsnummer bzw. PDF, aber abweichendes Brutto.');hints.push('Beide Fassungen vergleichen und eine mögliche Rechnungskorrektur manuell bearbeiten.');}
    return finish('Dublette');
  }
  // A missing invoice number cannot support the required unique business key.
  if(!number)return finish('Fehler','Rechnungsnummer am Original ergänzen, bevor eine Rechnung oder ein Kreditor angelegt wird.');
  const invoiceId='R-'+hash(vendor.row.KreditorID+'|'+number).slice(0,20);
  audit.RechnungID=invoiceId;
  if(vendor.isNew)result.vendors.push(vendor.row);
  finish('geschrieben');
  const invoice={RechnungID:invoiceId,KreditorID:vendor.row.KreditorID,ObjektID:match.row.ObjektID,Rechnungsnummer:clean(doc.rechnungsnummer),Belegart:doc.belegart,Datum:validDate(doc.datum)?doc.datum:null,Netto:header.netto,USt:header.ust,Brutto:header.brutto,'Fälligkeit':validDate(due)?due:null,Status:audit['Manuell prüfen']==='Ja'?'Klärung':'Erfasst','Währung':clean(doc.waehrung).toUpperCase(),Rechendifferenz:difference,'Prüfhinweis':audit.Prüfhinweis,PDF_SHA256:pdfHash,Leistungszeitraum:doc.leistungszeitraum??null,Skonto_Prozent:doc.skonto_prozent??null,Lohnanteil_35a:doc.lohnanteil_35a??null,Bezug_Rechnungsnummer:doc.bezug_rechnungsnummer??null,Pruefung_ok:!missing.length&&!calculationProblems.length?'Ja':'Nein',Dateiname:meta.filename??'',Mail_Absender:meta.from??'',Abschlaege_brutto:paid,Zahlbetrag:payable,Faelligkeit_Herleitung:dueOrigin,Netto_Herleitung:netOrigin};
  result.invoices.push(invoice);
  lines.forEach((line,index)=>result.positions.push({PositionID:invoiceId+'-P'+String(index+1).padStart(3,'0'),RechnungID:invoiceId,Pos_Nr:index+1,Beschreibung:line.beschreibung,Menge:line.menge,Einheit:line.einheit,Einzelpreis:line.einzelpreis,'Gesamt netto':line.gesamt_netto,'USt-Satz':finite(line.ust_satz)?line.ust_satz/100:null,USt_Status:line.ust_status??null,Kategorie:line.kategorie}));
  return result;
}

export function applyResult(ledger,result){
  if(result.idempotent)return ledger;
  ledger.Kreditoren.push(...result.vendors);ledger.Rechnungen.push(...result.invoices);ledger.Rechnungspositionen.push(...result.positions);
  const prior=ledger.Audit_Log.findIndex(row=>row.AuditID===result.audit.AuditID);
  if(prior>=0)ledger.Audit_Log[prior]=result.audit;else ledger.Audit_Log.push(result.audit);
  return ledger;
}
