// Bill files and review state stay in this browser's IndexedDB, never on our server.
let connection;
function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Browser storage is unavailable.'));
    const request = indexedDB.open('empealth-bills', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('bills', {keyPath:'id'});
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Empealth tabs and retry saving.'));
    request.onsuccess = () => {
      const db=request.result;
      db.onversionchange=()=>{db.close();connection=null;};
      resolve(db);
    };
  }).catch(error=>{connection=null;throw error;});
  return connection;
}
async function transaction(mode, operation) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('bills',mode), request=operation(tx.objectStore('bills'));
    tx.oncomplete=()=>resolve(request.result);
    tx.onerror=tx.onabort=()=>reject(tx.error||request.error||new Error('Saving was interrupted.'));
  });
}
export function billSummary(record) {
  const rows=record.state.rows||[];
  return {id:record.id,name:record.name,createdAt:record.createdAt,updatedAt:record.updatedAt,
    lineCount:rows.length,total:rows.reduce((sum,row)=>sum+(Number.isFinite(row.amount)?row.amount:0),0),
    hasFile:!!record.file,sample:record.state.sample,hasReview:!!record.state.aiResult};
}
export async function listBills() {
  const records=await transaction('readonly',store=>store.getAll());
  return records.map(billSummary).sort((a,b)=>b.updatedAt-a.updatedAt);
}
export const getBill=id=>transaction('readonly',store=>store.get(id));
export const putBill=record=>transaction('readwrite',store=>store.put(record));
export const deleteBill=id=>transaction('readwrite',store=>store.delete(id));
