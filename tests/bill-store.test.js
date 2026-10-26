import 'fake-indexeddb/auto';
import {IDBObjectStore} from 'fake-indexeddb';
import test from 'node:test';
import assert from 'node:assert/strict';
import {putBill,getBill,listBills,deleteBill} from '../src/bill-store.js';

const record=(id,updatedAt)=>({id,name:`Bill ${id}`,createdAt:1,updatedAt,
 file:new Blob(['original synthetic PDF'],{type:'application/pdf'}),
 state:{zip:'01234',rows:[{amount:285,confirmed:true},{amount:NaN,confirmed:false}],
  raw:'Synthetic original text',aiResult:{breakdown:['Assessment','Future costs']},
  scriptText:'My edited draft',profile:{name:'Demo patient'},sample:false}});

test('bills keep original bytes, missing amounts, edited drafts and reviews across new connections',async()=>{
 await putBill(record('first',10));
 const fresh=await import('../src/bill-store.js?new-session');
 const reopened=await fresh.getBill('first');
 assert.equal(await reopened.file.text(),'original synthetic PDF');
 assert.equal(reopened.state.zip,'01234');
 assert.ok(Number.isNaN(reopened.state.rows[1].amount));
 assert.equal(reopened.state.scriptText,'My edited draft');
 assert.deepEqual(reopened.state.aiResult.breakdown,['Assessment','Future costs']);
 assert.equal(reopened.state.profile.name,'Demo patient');
 await deleteBill('first');
});

test('updating and deleting one bill does not change another or duplicate a record',async()=>{
 await putBill(record('a',10));await putBill(record('b',20));
 const updated=await getBill('a');updated.name='Renamed';updated.updatedAt=30;
 await putBill(updated);
 const list=await listBills();
 assert.deepEqual(list.map(b=>b.id),['a','b']);
 assert.equal(list[0].name,'Renamed');assert.equal(list[0].total,285);
 assert.ok(!('file' in list[0])&&!('state' in list[0]));
 await deleteBill('a');
 assert.equal(await getBill('a'),undefined);
 assert.equal((await getBill('b')).state.scriptText,'My edited draft');
 await deleteBill('b');assert.deepEqual(await listBills(),[]);
});

test('an aborted write rejects and preserves the previous saved bill',async()=>{
 await putBill(record('preserved',10));
 const originalPut=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value){const request=originalPut.call(this,value);this.transaction.abort();return request;};
 try{await assert.rejects(putBill({...record('preserved',20),name:'Must not commit'}));}
 finally{IDBObjectStore.prototype.put=originalPut;}
 assert.equal((await getBill('preserved')).name,'Bill preserved');
 await deleteBill('preserved');
});

test('unavailable browser storage reports failure and can be retried',async()=>{
 const original=globalThis.indexedDB;
 const isolated=await import('../src/bill-store.js?unavailable');
 try{globalThis.indexedDB=undefined;await assert.rejects(isolated.listBills(),/unavailable/);}
 finally{globalThis.indexedDB=original;}
 assert.deepEqual(await isolated.listBills(),[]);
});
