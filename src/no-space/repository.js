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
    addDoc, collection, doc, getDocs, onSnapshot, query, runTransaction,
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
    }
  };
}
