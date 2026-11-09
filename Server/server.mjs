import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {hash,processDocument} from './engine.mjs';
import {documentDurationSeconds} from './duration.mjs';
import {loadWorkbook,readLedger,appendResult,saveWorkbook,createWorkbook} from './workbook.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.resolve(root,process.env.BELEGE_DATA_DIR??'data');
const privateDir=path.join(dataDir,'private');
const workbookFile=path.join(dataDir,'rechnungen.xlsx');
const demoFile=path.join(dataDir,'demo-rechnungen.xlsx');
await fs.mkdir(privateDir,{recursive:true,mode:0o700});
const tokenFile=path.join(privateDir,'bridge-token');
let token;try{token=(await fs.readFile(tokenFile,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;token=randomBytes(32).toString('hex');await fs.writeFile(tokenFile,token,{mode:0o600,flag:'wx'});}
try {
  await fs.access(workbookFile);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const temporary=path.join(dataDir,'.rechnungen-'+randomBytes(8).toString('hex')+'.xlsx');
  try {
    await saveWorkbook(createWorkbook(),temporary);
    await fs.link(temporary,workbookFile);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    await fs.rm(temporary,{force:true});
  }
}
const queues=new Map();
async function serial(key,fn){const prior=queues.get(key)??Promise.resolve();const next=prior.catch(()=>{}).then(fn);queues.set(key,next);try{return await next;}finally{if(queues.get(key)===next)queues.delete(key);}}
function authorized(req){const incoming=Buffer.from(String(req.headers['x-belege-token']??'')),expected=Buffer.from(token);return incoming.length===expected.length&&timingSafeEqual(incoming,expected);}
function send(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
function httpError(status,message){return Object.assign(new Error(message),{status});}
async function body(req){
  if(String(req.headers['content-type']??'').split(';')[0].trim().toLowerCase()!=='application/json')throw httpError(415,'Content-Type muss application/json sein.');
  const limit=32*1024*1024;
  let size=0,parts=[];
  // Drain an oversized request without retaining its body or destroying the
  // socket: the caller must still receive the useful HTTP 413 response.
  for await(const part of req){size+=part.length;if(size<=limit)parts.push(part);else parts=[];}
  if(size>limit)throw httpError(413,'Anfrage größer als 32 MB.');
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}
  catch(error){if(error instanceof SyntaxError)throw httpError(400,'Anfrage enthält kein gültiges JSON.');throw error;}
}
const redact=value=>String(value).replace(/sk-ant-[A-Za-z0-9_-]+/g,'[API-Schlüssel entfernt]');
async function handleEvent(input,demo){
  const requestStartedAt=performance.now();
  if(!input?.meta?.filename)throw Error('Dateiname fehlt.');
  if(!input.meta.messageId&&!input.meta.submittedAt)throw Error('Mail-ID oder Upload-ID fehlt; sichere Wiederholung nicht möglich.');
  const event={meta:input.meta,response:input.response??null,error:input.error?redact(input.error):undefined,mode:demo?'Demodaten':'Claude API'};
  if(input.pdfBase64){const bytes=Buffer.from(input.pdfBase64,'base64');event.pdfHash=hash(bytes);if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))event.error='Datei enthält keinen gültigen PDF-Kopf.';}
  else event.pdfHash=input.pdfHash??hash(JSON.stringify(input.response??input.error));
  const eventId=hash(JSON.stringify(event));
  const evidenceDir=path.join(privateDir,demo?'demo-evidence':'evidence');
  await fs.mkdir(evidenceDir,{recursive:true,mode:0o700});
  event.evidenceFile=path.relative(root,path.join(evidenceDir,eventId+'.json'));
  const evidencePath=path.join(root,event.evidenceFile);
  await fs.writeFile(evidencePath,JSON.stringify(event,null,2),{mode:0o600});
  const pendingDir=path.join(privateDir,demo?'demo-pending':'pending');
  await fs.mkdir(pendingDir,{recursive:true,mode:0o700});
  const pendingPath=path.join(pendingDir,eventId+'.json');
  await fs.writeFile(pendingPath,JSON.stringify(event),{mode:0o600});
  const filename=demo?demoFile:workbookFile;
  return serial(filename,async()=>{
    let lock;
    const lockfile=filename+'.processing-lock';
    try{
      lock=await fs.open(lockfile,'wx',0o600);
      const excelLock=path.join(path.dirname(filename),'~$'+path.basename(filename));
      try{await fs.access(excelLock);throw Error('Excel-Datei ist geöffnet. In Excel schließen, dann gespeicherte Ereignisse erneut verarbeiten.');}catch(error){if(error.code!=='ENOENT')throw error;}
      let workbook;
      try{workbook=await loadWorkbook(filename);}catch(error){if(!demo||error.code!=='ENOENT')throw error;workbook=createWorkbook({demo:true});await saveWorkbook(workbook,filename);}
      const originalHash=hash(await fs.readFile(filename));
      const result=processDocument(event,readLedger(workbook));
      if(!result.idempotent){
        // Freeze the elapsed extraction time in n8n. A saved retry must not count
        // the hours/days spent waiting before this local processing attempt.
        const upstreamMs=typeof event.meta.processingElapsedMs==='number'&&Number.isFinite(event.meta.processingElapsedMs)&&event.meta.processingElapsedMs>=0?event.meta.processingElapsedMs:0;
        result.audit.Dauer_s=documentDurationSeconds(0,upstreamMs+performance.now()-requestStartedAt);
        appendResult(workbook,result);
        const temp=filename+'.'+eventId.slice(0,10)+'.tmp.xlsx';
        try{await saveWorkbook(workbook,temp);if(hash(await fs.readFile(filename))!==originalHash)throw Error('Excel wurde während der Verarbeitung verändert. Ereignis bleibt zur Wiederholung gespeichert.');await fs.rename(temp,filename);}finally{await fs.unlink(temp).catch(()=>{});}
      }
      await fs.unlink(pendingPath);
      return {ok:true,ergebnis:result.audit.Ergebnis,status:result.invoices[0]?.Status??null,manuellPruefen:result.audit['Manuell prüfen']==='Ja',pruefhinweis:result.audit.Prüfhinweis,probleme:result.audit.Probleme,auditId:result.audit.AuditID,rechnungId:result.audit.RechnungID,idempotent:result.idempotent??false,auditAktualisiert:result.replaceAudit??false,dateiname:event.meta.filename,auslesemodus:event.mode,dauer_s:result.audit.Dauer_s??null,datei:filename};
    }finally{if(lock){await lock.close();await fs.unlink(lockfile).catch(()=>{});}}
  });
}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/health'&&req.method==='GET'){send(res,200,{ok:true,service:'Belege Excel lokal'});return;}
    if(!authorized(req)){send(res,401,{ok:false,error:'Lokale Verbindung ist nicht authentifiziert.'});return;}
    if(['/process','/demo/process'].includes(req.url)&&req.method==='POST'){send(res,200,await handleEvent(await body(req),req.url.startsWith('/demo/')));return;}
    if(req.url==='/pending'&&req.method==='GET'){const files=await fs.readdir(path.join(privateDir,'pending')).catch(()=>[]);send(res,200,{anzahl:files.length});return;}
    if(req.url==='/replay'&&req.method==='POST'){const dir=path.join(privateDir,'pending');const files=await fs.readdir(dir).catch(()=>[]);const results=[];for(const file of files.filter(f=>f.endsWith('.json'))){const event=JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));results.push(await handleEvent(event,false));await fs.unlink(path.join(dir,file)).catch(()=>{});}send(res,200,{results});return;}
    send(res,404,{error:'Unbekannter Endpunkt.'});
  }catch(error){send(res,error.status??503,{ok:false,error:redact(error.message),hinweis:'Bei Schreibfehlern bleibt das Ereignis lokal gespeichert. Excel schließen und Wiederholung starten.'});}
});
server.requestTimeout=180000;
server.listen(Number(process.env.BELEGE_PORT??5680),'127.0.0.1',()=>{
  console.log('Excel-Verbindung bereit auf http://127.0.0.1:'+server.address().port);
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
