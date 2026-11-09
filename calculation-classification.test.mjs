import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyLedger,processDocument} from './Server/engine.mjs';
import {invoice,event,demoObject} from './fixtures.mjs';

const addressHint='Rechnungsadresse (Verwaltung in Beispielstadt) weicht von der Liegenschaft (Musterstadt) ab.';
const state=()=>({...emptyLedger(),Objekte:[{
 ...structuredClone(demoObject),Adresse:'Musterweg 12, 12345 Musterstadt',PLZ:'12345',Ort:'Musterstadt',
}]});
function credit(patch={}){
 const doc=invoice({belegart:'Gutschrift',rechnungsadresse:'Musterverwaltung, Hauptstraße 5, 54321 Beispielstadt',hinweise:[addressHint],...patch});
 doc.verbrauchsstellen[0]={...doc.verbrauchsstellen[0],plz:'12345',ort:'Musterstadt',belegstelle:'Verbrauchsstelle: Musterweg 12, 12345 Musterstadt, Seite 1'};
 return doc;
}

test('abweichende Verwaltungsadresse bleibt ein Prüfhinweis, macht korrekte Gutschrift aber nicht zum Rechenfehler',()=>{
 const result=processDocument(event(credit()),state());
 assert.equal(result.audit.Ergebnis,'geschrieben');
 assert.equal(result.invoices[0].Netto,-100);
 assert.equal(result.invoices[0].USt,-19);
 assert.equal(result.invoices[0].Brutto,-119);
 assert.equal(result.invoices[0].Rechendifferenz,0);
 assert.equal(result.invoices[0].Pruefung_ok,'Ja');
 assert.equal(result.invoices[0].Status,'Klärung');
 assert.equal(result.audit['Manuell prüfen'],'Ja');
 assert.ok(result.audit.Probleme.includes(addressHint),'Der Adresshinweis muss zur manuellen Prüfung erhalten bleiben.');
 assert.doesNotMatch(result.audit.Prüfhinweis,/Nettopositionen.*nachrechnen/,'Ein Adressunterschied verlangt keine erneute Rechenprüfung.');
});

test('echte Summenabweichung bei derselben Gutschrift bleibt als Rechenfehler mit konkretem Hinweis erkennbar',()=>{
 const result=processDocument(event(credit({brutto:130})),state());
 assert.equal(result.audit.Ergebnis,'geschrieben');
 assert.equal(result.invoices[0].Pruefung_ok,'Nein');
 assert.equal(result.invoices[0].Status,'Klärung');
 assert.equal(result.invoices[0].Rechendifferenz,11);
 assert.equal(result.audit['Manuell prüfen'],'Ja');
 assert.match(result.audit.Probleme,/Netto \+ USt entspricht nicht dem Brutto/);
 assert.match(result.audit.Prüfhinweis,/Nettopositionen.*nachrechnen/);
 assert.ok(result.audit.Probleme.includes(addressHint),'Sachlicher Adresshinweis bleibt neben dem tatsächlichen Rechenfehler erhalten.');
});
