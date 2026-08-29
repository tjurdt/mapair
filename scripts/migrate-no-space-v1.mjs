#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  convertLegacySpace,
  migrationMarkerDisposition,
  validateMigrationOptions
} from "./no-space-migration.mjs";

function parseArgs(argv){
  const options={apply:false,confirm:""};
  for(let index=0;index<argv.length;index++){
    const arg=argv[index];
    if(arg==="--apply"){options.apply=true;continue;}
    if(["--project","--source-space","--confirm"].includes(arg)){
      if(!argv[index+1]||argv[index+1].startsWith("--")) throw new Error(`${arg} requires a value.`);
      options[arg.slice(2).replace("-","_")]=argv[++index]; continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if(!options.project||!options.source_space) throw new Error("Usage: node scripts/migrate-no-space-v1.mjs --project PROJECT --source-space SPACE [--apply --confirm MAPAIR_NO_SPACE_V1]");
  return options;
}
function jsonValue(_key,value){
  if(value && typeof value.toDate === "function") return {__type:"firestore-timestamp",iso:value.toDate().toISOString()};
  if(value && typeof value === "object" && typeof value.latitude === "number" && typeof value.longitude === "number") return {__type:"firestore-geopoint",latitude:value.latitude,longitude:value.longitude};
  return value;
}
async function readSource(db,spaceId){
  const root=db.doc(`spaces/${spaceId}`), meta=db.doc(`spaces/${spaceId}/meta/config`);
  const [rootSnap,metaSnap,placesSnap,tripsSnap,membersSnap]=await Promise.all([
    root.get(),meta.get(),db.collection(`spaces/${spaceId}/places`).get(),db.collection(`spaces/${spaceId}/trips`).get(),db.collection(`spaces/${spaceId}/members`).get()
  ]);
  return {
    backupDocuments:[
      {path:root.path,exists:rootSnap.exists,data:rootSnap.exists?rootSnap.data():null},
      {path:meta.path,exists:metaSnap.exists,data:metaSnap.exists?metaSnap.data():null},
      ...placesSnap.docs.map(doc=>({path:doc.ref.path,exists:true,data:doc.data()})),
      ...tripsSnap.docs.map(doc=>({path:doc.ref.path,exists:true,data:doc.data()})),
      ...membersSnap.docs.map(doc=>({path:doc.ref.path,exists:true,data:doc.data()}))
    ],
    spaceRoot:rootSnap.exists?rootSnap.data():null,
    spaceRootExists:rootSnap.exists,
    meta:metaSnap.exists?metaSnap.data():{},
    metaExists:metaSnap.exists,
    places:placesSnap.docs.map(doc=>({id:doc.id,data:doc.data()})),
    trips:tripsSnap.docs.map(doc=>({id:doc.id,data:doc.data()})),
    members:membersSnap.docs.map(doc=>({id:doc.id,data:doc.data()}))
  };
}
async function existingProfiles(db,firstPass){
  const ids=firstPass.documents.filter(item=>/^users\/[^/]+$/.test(item.path)).map(item=>item.path.split("/")[1]);
  const map=new Map();
  for(let index=0;index<ids.length;index+=100){
    const snapshots=await db.getAll(...ids.slice(index,index+100).map(uid=>db.doc(`users/${uid}`)));
    snapshots.forEach(snapshot=>{if(snapshot.exists)map.set(snapshot.id,snapshot.data());});
  }
  return map;
}
async function createVerifiedBackup(source,project,space){
  const directory=resolve("migration-backups");
  await mkdir(directory,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const path=resolve(directory,`no-space-v1-${project}-${space}-${stamp}.json`);
  const payload={version:1,project,sourceSpace:space,createdAt:new Date().toISOString(),documents:source.backupDocuments};
  const bytes=JSON.stringify(payload,jsonValue,2)+"\n";
  await writeFile(path,bytes,{encoding:"utf8",flag:"wx"});
  const readBack=await readFile(path,"utf8");
  const verified=JSON.parse(readBack);
  if(verified.documents.length!==source.backupDocuments.length) throw new Error("Backup verification failed: document count differs.");
  const expected=source.backupDocuments.map(item=>item.path).sort().join("\n");
  const actual=verified.documents.map(item=>item.path).sort().join("\n");
  if(expected!==actual||createHash("sha256").update(readBack).digest("hex")!==createHash("sha256").update(bytes).digest("hex")) throw new Error("Backup verification failed: content differs after write.");
  return path;
}
async function applyDocuments(db,documents){
  for(let index=0;index<documents.length;index+=400){
    const batch=db.batch();
    documents.slice(index,index+400).forEach(item=>batch.set(db.doc(item.path),item.data,{merge:item.merge===true}));
    await batch.commit();
  }
}
function markerData(result,status){
  return {
    version:1,
    sourceSpace:result.sourceSpace,
    sourceFingerprint:result.sourceFingerprint,
    planFingerprint:result.planFingerprint,
    sourceCounts:result.sourceCounts,
    targetCounts:result.counts,
    status,
    documentCount:result.documents.length
  };
}
async function claimMigration(db,result){
  const markerRef=db.doc("migrations/no-space-v1");
  return db.runTransaction(async transaction=>{
    const snapshot=await transaction.get(markerRef);
    const disposition=migrationMarkerDisposition(snapshot.exists?snapshot.data():null,result);
    if(disposition==="already-complete") return false;
    transaction.set(markerRef,{...markerData(result,"applying"),startedAt:new Date().toISOString()},{merge:false});
    return true;
  });
}
async function completeMigration(db,result){
  const markerRef=db.doc("migrations/no-space-v1");
  await db.runTransaction(async transaction=>{
    const snapshot=await transaction.get(markerRef);
    const disposition=migrationMarkerDisposition(snapshot.exists?snapshot.data():null,result);
    if(disposition==="already-complete") return;
    transaction.set(markerRef,{...markerData(result,"complete"),completedAt:new Date().toISOString()},{merge:false});
  });
}

try{
  const options=parseArgs(process.argv.slice(2));
  validateMigrationOptions(options,process.env.FIRESTORE_EMULATOR_HOST || "");
  const app=getApps()[0]||initializeApp({credential:applicationDefault(),projectId:options.project});
  const db=getFirestore(app);
  const source=await readSource(db,options.source_space);
  const importedAt=new Date().toISOString();
  const firstPass=convertLegacySpace({sourceSpace:options.source_space,...source,importedAt});
  const existingUsers=await existingProfiles(db,firstPass);
  const result=convertLegacySpace({sourceSpace:options.source_space,...source,existingUsers,importedAt});
  console.log(JSON.stringify({
    mode:options.apply?"APPLY":"DRY RUN",project:options.project,sourceSpace:options.source_space,
    sourceFingerprint:result.sourceFingerprint,planFingerprint:result.planFingerprint,
    sourceCounts:result.sourceCounts,targetCounts:result.counts,
    warnings:result.warnings,blockers:result.blockers
  },null,2));
  if(result.blockers.length) throw new Error(`${result.blockers.length} blocking migration issue(s); no writes performed.`);
  if(!options.apply){ console.log("DRY RUN complete. No documents were written."); process.exit(0); }
  const markerSnapshot=await db.doc("migrations/no-space-v1").get();
  if(migrationMarkerDisposition(markerSnapshot.exists?markerSnapshot.data():null,result)==="already-complete"){
    console.log("Migration already completed with the same source and plan fingerprints. No documents were rewritten.");
    process.exit(0);
  }
  const backupPath=await createVerifiedBackup(source,options.project,options.source_space);
  console.log(`Verified local backup: ${backupPath}`);
  const claimed=await claimMigration(db,result);
  if(!claimed){
    console.log("Migration was completed concurrently with the same fingerprints. No target documents were rewritten.");
    process.exit(0);
  }
  await applyDocuments(db,result.documents);
  await completeMigration(db,result);
  console.log(`Migration applied: ${result.documents.length} target documents written. Legacy spaces/${options.source_space} was not changed.`);
}catch(error){
  console.error(`Migration stopped: ${error.message}`);
  process.exitCode=1;
}
