import { DatabaseSync } from 'node:sqlite';
import { readFileSync,mkdirSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { INSERT,values } from '../worker/waitlist.mjs';
export function createStore(filename=process.env.WAITLIST_DB_PATH??'.data/waitlist.sqlite'){
 const path=resolve(filename);mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);
 db.exec(readFileSync(new URL('../drizzle/0000_waitlist.sql',import.meta.url),'utf8').replace('CREATE TABLE `waitlist`','CREATE TABLE IF NOT EXISTS `waitlist`'));
 const statement=db.prepare(INSERT);
 return {save:async record=>{statement.run(...values(record));},close:()=>db.close()};
}
