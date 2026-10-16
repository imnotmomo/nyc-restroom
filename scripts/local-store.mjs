import { DatabaseSync } from 'node:sqlite';
import { readFileSync,mkdirSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { createD1ConfirmationStore } from '../worker/confirmation-outbox.mjs';
export function createStore(filename=process.env.WAITLIST_DB_PATH??'.data/waitlist.sqlite'){
 const path=resolve(filename);mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);
 db.exec(readFileSync(new URL('../drizzle/0000_waitlist.sql',import.meta.url),'utf8').replace('CREATE TABLE `waitlist`','CREATE TABLE IF NOT EXISTS `waitlist`'));
 db.exec(readFileSync(new URL('../drizzle/0001_waitlist_confirmations.sql',import.meta.url),'utf8').replace(/CREATE TABLE (?!IF NOT EXISTS)/g,'CREATE TABLE IF NOT EXISTS ').replace(/CREATE INDEX (?!IF NOT EXISTS)/g,'CREATE INDEX IF NOT EXISTS '));
 db.exec('PRAGMA busy_timeout=5000');
 const adapter={
  prepare(sql){return {bind(...parameters){
   const execute=()=>{
    const statement=db.prepare(sql);
    if (/^\s*SELECT\b/i.test(sql)||/\bRETURNING\b/i.test(sql)) {const results=statement.all(...parameters);return {results,meta:{changes:/^\s*SELECT\b/i.test(sql)?0:results.length}};}
    const result=statement.run(...parameters);return {results:[],meta:{changes:Number(result.changes)}};
   };
   return {run:execute,execute,first(){return execute().results[0]??null;}};
  }};},
  batch(statements){
   db.exec('BEGIN IMMEDIATE');
   try{const results=statements.map(statement=>statement.execute());db.exec('COMMIT');return results;}
   catch(error){db.exec('ROLLBACK');throw error;}
  },
 };
 return {...createD1ConfirmationStore(adapter),close:()=>db.close()};
}
