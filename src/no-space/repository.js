import { contributionFields } from "./contributions.js";
import { externalPlaceDocumentId, externalPlaceIdentity, selectExactExternalPlace } from "./places.js";
import { placeObjectiveFields, tripSharedFields, visitSharedFields } from "./schema.js";
import { canDeleteTrip, canDeleteVisit, canEditTripSharedFacts, canEditVisitSharedFacts, canViewVisit } from "./policies.js";

export const noSpacePaths = Object.freeze({
  user:uid => `users/${uid}`,
  place:placeId => `places/${placeId}`,
  visit:visitId => `visits/${visitId}`,
  trip:tripId => `trips/${tripId}`,
  contribution:(visitId, uid) => `visits/${visitId}/contributions/${uid}`,
  dayOrder:(uid, date) => `users/${uid}/dayOrders/${date}`
});

export function createNoSpaceRepository({ db, firestore, uid }){
  if (!db || !firestore || !uid) throw new Error("No-Space repository requires db, Firestore helpers, and uid.");
  const {
    addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, runTransaction,
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
      const identity=externalPlaceIdentity(objective);
      if(identity){
        const exactSnapshot=await getDocs(query(col("places"),where("extId","==",identity.extId)));
        const exact=selectExactExternalPlace(exactSnapshot.docs.map(item=>({id:item.id,...item.data()})),objective);
        if(exact){
          const sharedVisit=visitSharedFields({...visitInput,placeId:exact.id,createdBy:uid});
          if(!canEditVisitSharedFacts(uid,sharedVisit)) throw new Error("The creator must participate in a new Visit.");
          const visitRef=await addDoc(col("visits"),{...sharedVisit,createdAt:stamp(),updatedAt:stamp()});
          return {placeId:exact.id,visitId:visitRef.id,reusedPlace:true};
        }
      }
      const deterministicId=externalPlaceDocumentId(objective);
      const placeRef = deterministicId?ref(noSpacePaths.place(deterministicId)):doc(col("places"));
      const visitRef = doc(col("visits"));
      const sharedVisit=visitSharedFields({ ...visitInput, placeId:placeRef.id, createdBy:uid });
      if (!canEditVisitSharedFacts(uid,sharedVisit)) throw new Error("The creator must participate in a new Visit.");
      if(deterministicId){
        await runTransaction(db,async transaction=>{
          const existing=await transaction.get(placeRef);
          if(!existing.exists()) transaction.set(placeRef,{...objective,createdBy:uid,createdAt:stamp()});
          transaction.set(visitRef,{...sharedVisit,createdAt:stamp(),updatedAt:stamp()});
        });
        return { placeId:placeRef.id, visitId:visitRef.id, reusedPlace:false };
      }
      const batch = writeBatch(db);
      batch.set(placeRef, { ...objective, createdBy:uid, createdAt:stamp() });
      batch.set(visitRef, { ...sharedVisit, createdAt:stamp(), updatedAt:stamp() });
      await batch.commit();
      return { placeId:placeRef.id, visitId:visitRef.id, reusedPlace:false };
    },
    updatePlaceCache(placeId, fields){ return updateDoc(ref(noSpacePaths.place(placeId)), fields); },
    updateVisit(visitId, input){
      const createdBy = input.createdBy || uid;
      const shared=visitSharedFields({ ...input, createdBy });
      if (!canEditVisitSharedFacts(uid,shared)) throw new Error("Only a participant may edit shared Visit facts.");
      const { createdBy:ignoredCreator, ...editable } = shared;
      return updateDoc(ref(noSpacePaths.visit(visitId)), { ...editable, updatedAt:stamp() });
    },
    async deleteVisit(visitId, visit){
      if (!canDeleteVisit(uid,visit)) throw new Error("Only the Visit creator may delete it in Phase A.");
      const contributionSnapshot=await getDocs(col(noSpacePaths.visit(visitId)+"/contributions"));
      if(contributionSnapshot.docs.length>499){
        throw new Error("Visit deletion stopped: more than 499 contributions require a separately designed cleanup job.");
      }
      const batch=writeBatch(db);
      contributionSnapshot.docs.forEach(item=>batch.delete(item.ref));
      batch.delete(ref(noSpacePaths.visit(visitId)));
      await batch.commit();
    },
    setContribution(visitId, input, visit){
      if(!canViewVisit(uid,visit)) throw new Error("Only a current Visit participant may edit a contribution.");
      return setDoc(ref(noSpacePaths.contribution(visitId, uid)), { ...contributionFields(input), updatedAt:stamp() }, { merge:true });
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
      const shared=tripSharedFields(input);
      if (!canEditTripSharedFacts(uid,shared)) throw new Error("Only a participant may edit shared Trip facts.");
      const { createdBy:ignoredCreator, ...editable } = shared;
      return updateDoc(ref(noSpacePaths.trip(tripId)), { ...editable, updatedAt:stamp() });
    },
    deleteTrip(tripId, trip){
      if (!canDeleteTrip(uid,trip)) throw new Error("Only the Trip creator may delete it in Phase A.");
      return deleteDoc(ref(noSpacePaths.trip(tripId)));
    },
    updateOwnProfile(input){
      const displayName = typeof input?.displayName === "string" ? input.displayName.trim() : "";
      const photoURL = typeof input?.photoURL === "string" ? input.photoURL.trim() : "";
      return setDoc(ref(noSpacePaths.user(uid)), { displayName, photoURL, updatedAt:stamp() }, { merge:true });
    }
  };
}
