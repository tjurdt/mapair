import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { externalPlaceDocumentId } from "../src/no-space/places.js";

const projectId="demo-mapair-no-space-rules";
const rules=await readFile(new URL("../firestore.no-space.rules",import.meta.url),"utf8");
const testEnv=await initializeTestEnvironment({projectId,firestore:{rules,host:"127.0.0.1",port:8085}});
const A="test-user-a",B="test-user-b",OUTSIDER="test-user-z";
const PRIVATE_PLACE_ID=externalPlaceDocumentId({source:"google",extId:"ChIJ-private-review"});
const baseVisit={placeId:"place-1",date:"2026-08-29",category:"咖啡",participantUserIds:[A,B],tripId:null,level:"旅遊",kind:"visit",endDate:"",createdBy:A};
const baseTrip={name:"夏日旅行",emoji:"🧭",startDate:"2026-08-29",endDate:"2026-08-30",color:"#3f7d78",participantUserIds:[A,B],createdBy:A};

try{
  await testEnv.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,"visits/visit-1"),baseVisit);
    await setDoc(doc(db,"visits/visit-deleting"),{...baseVisit,deleting:true});
    await setDoc(doc(db,"visits/visit-1/contributions/a"),{rating:4.5,memory:"A"});
    await setDoc(doc(db,"trips/trip-1"),baseTrip);
    await setDoc(doc(db,"places/place-1"),{name:"Cafe",lat:25,lng:121,source:"map",extId:null,admin:{}});
    await setDoc(doc(db,`places/${PRIVATE_PLACE_ID}`),{name:"Known Google Place",lat:25,lng:121,source:"google",extId:"ChIJ-private-review",admin:{}});
    await setDoc(doc(db,`places/${PRIVATE_PLACE_ID}/legacyImports/space-us`),{
      rating:4.5,review:"private shared memory",level:"旅遊",sourceSpace:"us",sourcePlaceId:"legacy-google",
      participantUserIds:[A,B]
    });
    await setDoc(doc(db,"users/a"),{displayName:"A"});
  });
  const dbA=testEnv.authenticatedContext(A).firestore();
  const dbB=testEnv.authenticatedContext(B).firestore();
  const dbOut=testEnv.authenticatedContext(OUTSIDER).firestore();

  await assertSucceeds(getDoc(doc(dbA,"visits/visit-1")));
  await assertFails(getDoc(doc(dbOut,"visits/visit-1")));
  await assertFails(updateDoc(doc(dbOut,"visits/visit-1"),{category:"stale"}));
  await assertFails(updateDoc(doc(dbB,"visits/visit-1"),{createdBy:B}));
  await assertFails(updateDoc(doc(dbB,"visits/visit-1"),{participantUserIds:[A]}));
  await assertSucceeds(updateDoc(doc(dbB,"visits/visit-1"),{category:"晚餐"}));
  await assertSucceeds(updateDoc(doc(dbB,"visits/visit-1"),{level:"住宿",kind:"stay",endDate:"2026-08-30"}));
  await assertSucceeds(updateDoc(doc(dbB,"visits/visit-1"),{level:"旅遊",kind:"visit",endDate:""}));
  await assertFails(updateDoc(doc(dbA,"visits/visit-1"),{level:"隨便"}));

  await assertSucceeds(setDoc(doc(dbA,"visits/visit-1/contributions/test-user-a"),{rating:5,memory:"我的回憶"}));
  await assertSucceeds(getDoc(doc(dbB,"visits/visit-1/contributions/test-user-a")));
  await assertFails(getDoc(doc(dbOut,"visits/visit-1/contributions/test-user-a")));
  await assertSucceeds(getDocs(collection(dbB,"visits/visit-1/contributions")));
  await assertFails(getDocs(collection(dbOut,"visits/visit-1/contributions")));
  await assertFails(setDoc(doc(dbB,"visits/visit-1/contributions/test-user-a"),{rating:1,memory:"not mine"}));
  await assertFails(setDoc(doc(dbB,"visits/visit-deleting/contributions/test-user-b"),{rating:4}));

  await assertSucceeds(setDoc(doc(dbA,"users/test-user-a/dayOrders/2026-08-29"),{visitIds:["visit-1"]}));
  await assertFails(setDoc(doc(dbB,"users/test-user-a/dayOrders/2026-08-29"),{visitIds:[]}));
  await assertFails(getDocs(collection(dbA,"users")));
  await assertFails(getDocs(collection(dbA,"places")));

  // Friends address book (users/{uid}/friends/{friendUid}) — owner-only.
  await assertSucceeds(setDoc(doc(dbA,"users/test-user-a/friends/test-user-b"),{nickname:"阿光",pinned:false,state:"linked",createdAt:new Date()}));
  await assertSucceeds(getDoc(doc(dbA,"users/test-user-a/friends/test-user-b")));
  await assertSucceeds(getDocs(collection(dbA,"users/test-user-a/friends")));
  await assertSucceeds(setDoc(doc(dbA,"users/test-user-a/friends/test-user-b"),{pinned:true},{merge:true}));
  await assertFails(getDoc(doc(dbB,"users/test-user-a/friends/test-user-b")));
  await assertFails(getDocs(collection(dbB,"users/test-user-a/friends")));
  await assertFails(setDoc(doc(dbB,"users/test-user-a/friends/test-user-b"),{nickname:"hax",pinned:false,state:"linked"}));
  await assertFails(setDoc(doc(dbA,"users/test-user-a/friends/test-user-c"),{nickname:"x",pinned:false,state:"linked",note:"extra"}));
  await assertFails(setDoc(doc(dbA,"users/test-user-a/friends/test-user-c"),{nickname:"x",pinned:false,state:"banana"}));
  await assertFails(deleteDoc(doc(dbB,"users/test-user-a/friends/test-user-b")));
  await assertSucceeds(deleteDoc(doc(dbA,"users/test-user-a/friends/test-user-b")));
  await assertSucceeds(getDoc(doc(dbA,"places/place-1")));

  await assertSucceeds(getDoc(doc(dbB,"trips/trip-1")));
  await assertSucceeds(updateDoc(doc(dbB,"trips/trip-1"),{name:"同行旅程"}));
  await assertFails(updateDoc(doc(dbB,"trips/trip-1"),{participantUserIds:[A]}));
  await assertFails(getDoc(doc(dbOut,"trips/trip-1")));
  await assertFails(setDoc(doc(dbA,"migrations/no-space-v1"),{status:"complete"}));
  await assertSucceeds(getDoc(doc(dbA,`places/${PRIVATE_PLACE_ID}/legacyImports/space-us`)));
  await assertSucceeds(getDoc(doc(dbB,`places/${PRIVATE_PLACE_ID}/legacyImports/space-us`)));
  await assertFails(getDoc(doc(dbOut,`places/${PRIVATE_PLACE_ID}/legacyImports/space-us`)));
  await assertFails(setDoc(doc(dbA,`places/${PRIVATE_PLACE_ID}/legacyImports/space-us`),{review:"tamper"}));
  await assertSucceeds(getDoc(doc(dbA,"appConfig/defaults")));

  const visible=query(collection(dbA,"visits"),where("participantUserIds","array-contains",A));
  assert.equal((await assertSucceeds(getDocs(visible))).size,2);

  // A participant can create a Visit that carries the shared "造訪深度" (level).
  await assertSucceeds(setDoc(doc(dbA,"visits/visit-created"),{...baseVisit,participantUserIds:[A]}));
  await assertFails(setDoc(doc(dbOut,"visits/visit-created-bad"),{...baseVisit,participantUserIds:[OUTSIDER],level:"bogus",createdBy:OUTSIDER}));
  await testEnv.withSecurityRulesDisabled(async context=>{ await context.firestore().doc("visits/visit-created").delete(); });

  await assertSucceeds(updateDoc(doc(dbA,"visits/visit-1"),{deleting:true,deletingAt:new Date()}));
  const batch=writeBatch(dbA);
  batch.delete(doc(dbA,"visits/visit-1/contributions/a"));
  batch.delete(doc(dbA,"visits/visit-1"));
  await assertSucceeds(batch.commit());
} finally {
  await testEnv.cleanup();
}

console.log("No-Space Firestore Rules assertions passed");
