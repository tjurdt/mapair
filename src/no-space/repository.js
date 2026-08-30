import { contributionFields } from "./contributions.js";
import { externalPlaceDocumentId } from "./places.js";
import { assertDocumentId, placeObjectiveFields, tripSharedFields, visitSharedFields } from "./schema.js";
import { normalizeFriendCode, randomFriendCode } from "../friends.js";
import { canDeleteTrip, canDeleteVisit, canEditTripSharedFacts, canEditVisitSharedFacts, canViewVisit } from "./policies.js";

export const noSpacePaths = Object.freeze({
  user:uid => `users/${uid}`,
  place:placeId => `places/${placeId}`,
  visit:visitId => `visits/${visitId}`,
  trip:tripId => `trips/${tripId}`,
  defaults:() => "appConfig/defaults",
  legacyImport:(placeId, sourceSpace="us") => `places/${placeId}/legacyImports/space-${sourceSpace}`,
  contribution:(visitId, uid) => `visits/${visitId}/contributions/${uid}`,
  dayOrder:(uid, date) => `users/${uid}/dayOrders/${date}`,
  friend:(uid, friendUid) => `users/${uid}/friends/${friendUid}`,
  friendRequest:(fromUid, toUid) => `friendRequests/${fromUid}__${toUid}`
});

export function createNoSpaceRepository({ db, firestore, uid }){
  if (!db || !firestore || !uid) throw new Error("No-Space repository requires db, Firestore helpers, and uid.");
  const {
    addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, runTransaction,
    serverTimestamp, setDoc, updateDoc, where, writeBatch
  } = firestore;
  const stamp = () => serverTimestamp();
  const ref = path => doc(db, ...path.split("/"));
  const col = path => collection(db, ...path.split("/"));

  return {
    uid,
    listenVisibleVisits(next, error){
      return onSnapshot(query(col("visits"), where("participantUserIds", "array-contains", uid)), next, error);
    },
    listenVisibleTrips(next, error){
      return onSnapshot(query(col("trips"), where("participantUserIds", "array-contains", uid)), next, error);
    },
    listenDefaults(next, error){ return onSnapshot(ref(noSpacePaths.defaults()), next, error); },
    listenLegacyImport(placeId, next, error){ return onSnapshot(ref(noSpacePaths.legacyImport(placeId)), next, error); },
    listenDayOrders(next, error){ return onSnapshot(col(noSpacePaths.user(uid) + "/dayOrders"), next, error); },
    listenPlace(placeId, next, error){ return onSnapshot(ref(noSpacePaths.place(placeId)), next, error); },
    listenContributions(visitId, next, error){ return onSnapshot(col(noSpacePaths.visit(visitId) + "/contributions"), next, error); },
    listenUser(userId, next, error){ return onSnapshot(ref(noSpacePaths.user(userId)), next, error); },
    async createVisit(input){
      const shared = visitSharedFields({ ...input, createdBy:uid });
      if (!canEditVisitSharedFacts(uid,shared)) throw new Error("The creator must participate in a new Visit.");
      return addDoc(col("visits"), { ...shared, createdAt:stamp(), updatedAt:stamp() });
    },
    async createPlaceAndVisit(placeInput, visitInput){
      const objective=placeObjectiveFields(placeInput);
      const deterministicId=externalPlaceDocumentId(objective);
      const placeRef = deterministicId?ref(noSpacePaths.place(deterministicId)):doc(col("places"));
      const visitRef = doc(col("visits"));
      const sharedVisit=visitSharedFields({ ...visitInput, placeId:placeRef.id, createdBy:uid });
      if (!canEditVisitSharedFacts(uid,sharedVisit)) throw new Error("The creator must participate in a new Visit.");
      if(deterministicId){
        const reusedPlace=await runTransaction(db,async transaction=>{
          const existing=await transaction.get(placeRef);
          if(!existing.exists()) transaction.set(placeRef,{...objective,createdBy:uid,createdAt:stamp()});
          transaction.set(visitRef,{...sharedVisit,createdAt:stamp(),updatedAt:stamp()});
          return existing.exists();
        });
        return { placeId:placeRef.id, visitId:visitRef.id, reusedPlace };
      }
      const batch = writeBatch(db);
      batch.set(placeRef, { ...objective, createdBy:uid, createdAt:stamp() });
      batch.set(visitRef, { ...sharedVisit, createdAt:stamp(), updatedAt:stamp() });
      await batch.commit();
      return { placeId:placeRef.id, visitId:visitRef.id, reusedPlace:false };
    },
    updatePlaceCache(placeId, fields){ return updateDoc(ref(noSpacePaths.place(placeId)), fields); },
    updateVisit(visitId, input){
      const visitRef=ref(noSpacePaths.visit(visitId));
      return runTransaction(db,async transaction=>{
        const snapshot=await transaction.get(visitRef);
        if(!snapshot.exists()) throw new Error("Visit no longer exists.");
        const current=snapshot.data();
        if(current.deleting) throw new Error("Visit is being deleted and cannot be edited.");
        if(!canEditVisitSharedFacts(uid,current)) throw new Error("Only a current participant may edit shared Visit facts.");
        const shared=visitSharedFields({...input,createdBy:current.createdBy});
        if(!canEditVisitSharedFacts(uid,shared)) throw new Error("Phase A Visit editing cannot remove the current User.");
        const {createdBy:ignoredCreator,...editable}=shared;
        transaction.update(visitRef,{...editable,updatedAt:stamp()});
      });
    },
    async deleteVisit(visitId){
      const visitRef=ref(noSpacePaths.visit(visitId));
      await runTransaction(db,async transaction=>{
        const snapshot=await transaction.get(visitRef);
        if(!snapshot.exists()) throw new Error("Visit no longer exists.");
        const current=snapshot.data();
        if(!canDeleteVisit(uid,current)) throw new Error("Only the stored Visit creator may delete it in Phase A.");
        if(!current.deleting){
          transaction.update(visitRef,{deleting:true,deletingAt:stamp(),updatedAt:stamp()});
        }
      });
      let contributionSnapshot;
      try{
        contributionSnapshot=await getDocs(col(noSpacePaths.visit(visitId)+"/contributions"));
      }catch(error){
        throw new Error(`Visit deletion could not read its final contributions; it remains marked deleting and may be retried. ${error.message}`);
      }
      if(contributionSnapshot.docs.length>499){
        try{
          await runTransaction(db,async transaction=>{
            const snapshot=await transaction.get(visitRef);
            const current=snapshot.exists()?snapshot.data():null;
            if(current?.deleting&&canDeleteVisit(uid,current)){
              transaction.update(visitRef,{deleting:false,deletingAt:null,updatedAt:stamp()});
            }
          });
        }catch(error){
          throw new Error(`Visit deletion stopped with more than 499 contributions, and its deletion marker could not be cleared. ${error.message}`);
        }
        throw new Error("Visit deletion stopped: more than 499 contributions require a separately designed cleanup job.");
      }
      const batch=writeBatch(db);
      contributionSnapshot.docs.forEach(item=>batch.delete(item.ref));
      batch.delete(visitRef);
      try{
        await batch.commit();
      }catch(error){
        throw new Error(`Visit deletion did not complete; it remains marked deleting and may be retried. ${error.message}`);
      }
    },
    setContribution(visitId, input){
      const visitRef=ref(noSpacePaths.visit(visitId));
      const contributionRef=ref(noSpacePaths.contribution(visitId,uid));
      const contribution=contributionFields(input);
      return runTransaction(db,async transaction=>{
        const snapshot=await transaction.get(visitRef);
        if(!snapshot.exists()) throw new Error("Visit no longer exists.");
        const current=snapshot.data();
        if(current.deleting) throw new Error("Visit is being deleted and cannot accept contributions.");
        if(!canViewVisit(uid,current)) throw new Error("Only a current Visit participant may edit a contribution.");
        transaction.set(contributionRef,{...contribution,updatedAt:stamp()},{merge:true});
      });
    },
    setDayOrder(date, visitIds){
      return setDoc(ref(noSpacePaths.dayOrder(uid, date)), { visitIds:[...visitIds], updatedAt:stamp() });
    },
    createTrip(input){
      const shared = tripSharedFields({ ...input, createdBy:uid });
      if (!canEditTripSharedFacts(uid,shared)) throw new Error("The creator must participate in a new Trip.");
      return addDoc(col("trips"), { ...shared, createdAt:stamp(), updatedAt:stamp() });
    },
    updateTrip(tripId, input){
      const tripRef=ref(noSpacePaths.trip(tripId));
      return runTransaction(db,async transaction=>{
        const snapshot=await transaction.get(tripRef);
        if(!snapshot.exists()) throw new Error("Trip no longer exists.");
        const current=snapshot.data();
        if(!canEditTripSharedFacts(uid,current)) throw new Error("Only a current participant may edit shared Trip facts.");
        const shared=tripSharedFields({...input,createdBy:current.createdBy});
        if(!canEditTripSharedFacts(uid,shared)) throw new Error("Phase A Trip editing cannot remove the current User.");
        const {createdBy:ignoredCreator,...editable}=shared;
        transaction.update(tripRef,{...editable,updatedAt:stamp()});
      });
    },
    deleteTrip(tripId){
      const tripRef=ref(noSpacePaths.trip(tripId));
      return runTransaction(db,async transaction=>{
        const snapshot=await transaction.get(tripRef);
        if(!snapshot.exists()) throw new Error("Trip no longer exists.");
        if(!canDeleteTrip(uid,snapshot.data())) throw new Error("Only the stored Trip creator may delete it in Phase A.");
        transaction.delete(tripRef);
      });
    },
    updateOwnProfile(input){
      const displayName = typeof input?.displayName === "string" ? input.displayName.trim() : "";
      const photoURL = typeof input?.photoURL === "string" ? input.photoURL.trim() : "";
      return setDoc(ref(noSpacePaths.user(uid)), { displayName, photoURL, updatedAt:stamp() }, { merge:true });
    },
    // Personal display preferences on the User document (not shared Visit data).
    // setDoc(merge) creates the doc if absent, then updateDoc replaces each map
    // field wholesale so a cleared colour override is actually removed.
    async updateOwnPreferences(prefs){
      const hexMap = value => Object.fromEntries(Object.entries(value || {})
        .filter(([key, hex]) => typeof key === "string" && /^#[0-9a-fA-F]{6}$/.test(String(hex))));
      const payload = {
        categoryPicks:[...new Set((Array.isArray(prefs?.categoryPicks) ? prefs.categoryPicks : [])
          .filter(item => typeof item === "string" && item.trim()).map(item => item.trim()))],
        categoryColors:hexMap(prefs?.categoryColors),
        levelColors:hexMap(prefs?.levelColors),
        updatedAt:stamp()
      };
      const userRef = ref(noSpacePaths.user(uid));
      await setDoc(userRef, payload, { merge:true });
      await updateDoc(userRef, payload);
    },
    // Per-user friend address book at users/{uid}/friends/{friendUid}. Owned
    // entirely by the authenticated user; a friend entry only makes a person
    // selectable and never touches any Visit/Trip. A mutual link is reached
    // through a friendRequests/{from}__{to} handshake. See docs/FRIENDS.md.
    listenFriends(next, error){ return onSnapshot(col(noSpacePaths.user(uid) + "/friends"), next, error); },
    listenIncomingFriendRequests(next, error){
      return onSnapshot(query(col("friendRequests"), where("to", "==", uid)), next, error);
    },
    listenOutgoingFriendRequests(next, error){
      return onSnapshot(query(col("friendRequests"), where("from", "==", uid)), next, error);
    },
    // Ask `toUid` to become a friend: create the request they will see, and a
    // local pending_out marker (held out of the pickers until it links).
    async sendFriendRequest(toUid){
      const id = assertDocumentId(toUid, "toUid");
      if (id === uid) throw new Error("You cannot add yourself as a friend.");
      const batch = writeBatch(db);
      batch.set(ref(noSpacePaths.friendRequest(uid, id)), { from:uid, to:id, state:"pending", createdAt:stamp() });
      batch.set(ref(noSpacePaths.friend(uid, id)), { nickname:"", pinned:false, state:"pending_out", createdAt:stamp() }, { merge:true });
      return batch.commit();
    },
    // Accept an incoming request from `fromUid`: link them on my side and mark
    // the request accepted so their client can finalise.
    async acceptFriendRequest(fromUid){
      const id = assertDocumentId(fromUid, "fromUid");
      const batch = writeBatch(db);
      batch.set(ref(noSpacePaths.friend(uid, id)), { nickname:"", pinned:false, state:"linked", createdAt:stamp() }, { merge:true });
      batch.update(ref(noSpacePaths.friendRequest(id, uid)), { state:"accepted" });
      return batch.commit();
    },
    declineFriendRequest(fromUid){
      const id = assertDocumentId(fromUid, "fromUid");
      return updateDoc(ref(noSpacePaths.friendRequest(id, uid)), { state:"declined" });
    },
    // My outgoing request was accepted: promote the pending_out marker and drop
    // the resolved request doc.
    async finalizeAcceptedRequest(toUid){
      const id = assertDocumentId(toUid, "toUid");
      await setDoc(ref(noSpacePaths.friend(uid, id)), { state:"linked" }, { merge:true });
      try { await deleteDoc(ref(noSpacePaths.friendRequest(uid, id))); } catch(e) {}
    },
    // Cancel my outgoing request, or clear it after a decline.
    async discardOutgoingRequest(toUid){
      const id = assertDocumentId(toUid, "toUid");
      await deleteDoc(ref(noSpacePaths.friend(uid, id)));
      try { await deleteDoc(ref(noSpacePaths.friendRequest(uid, id))); } catch(e) {}
    },
    removeFriend(friendUid){
      return deleteDoc(ref(noSpacePaths.friend(uid, assertDocumentId(friendUid, "friendUid"))));
    },
    setFriendNickname(friendUid, nickname){
      const value = typeof nickname === "string" ? nickname.trim().slice(0, 60) : "";
      return setDoc(ref(noSpacePaths.friend(uid, assertDocumentId(friendUid, "friendUid"))),
        { nickname:value }, { merge:true });
    },
    setFriendPinned(friendUid, pinned){
      return setDoc(ref(noSpacePaths.friend(uid, assertDocumentId(friendUid, "friendUid"))),
        { pinned: pinned === true }, { merge:true });
    },
    // Short friend code: a public 6-char handle at friendCodes/{code} -> uid, so
    // people can be added without pasting a 28-char UID. Codes are permanent and
    // claimed once; a claim collision just retries with a fresh code.
    async ensureFriendCode(){
      const userRef = ref(noSpacePaths.user(uid));
      return runTransaction(db, async transaction => {
        const userSnap = await transaction.get(userRef);
        const existing = userSnap.exists() ? userSnap.data().friendCode : "";
        if (typeof existing === "string" && normalizeFriendCode(existing)) return existing;
        for (let attempt = 0; attempt < 5; attempt++){
          const code = randomFriendCode();
          const codeRef = doc(db, "friendCodes", code);
          if ((await transaction.get(codeRef)).exists()) continue;
          transaction.set(codeRef, { uid });
          transaction.set(userRef, { friendCode:code }, { merge:true });
          return code;
        }
        throw new Error("Could not allocate a friend code. Please try again.");
      });
    },
    async uidForFriendCode(code){
      const clean = normalizeFriendCode(code);
      if (!clean) return null;
      const snap = await getDoc(doc(db, "friendCodes", clean));
      const value = snap.exists() ? snap.data().uid : "";
      return (typeof value === "string" && value.trim()) ? value.trim() : null;
    }
  };
}
