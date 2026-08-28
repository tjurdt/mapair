#!/usr/bin/env node

import { loadAndValidateFixtures } from "./fixture-support.mjs";

async function main(){
  const { baselineDocuments, additiveDocuments, counts, noSpaceDocuments, noSpaceCounts } = await loadAndValidateFixtures();
  console.log("Fixture validation passed.");
  console.log(`Baseline: ${baselineDocuments.length} documents (1 meta, 1 trip, 7 places).`);
  console.log(`Multi-user overlay: ${additiveDocuments.length} documents (${counts.users} users, ${counts.spaces} spaces, ${counts.memberships} memberships, ${counts.trips} trip, ${counts.places} places, ${counts.friendships} friendships, ${counts.invitations} invitations).`);
  console.log("Effective group Trip defaults: test-user-a, test-user-b, test-user-c.");
  console.log(`No-Space: ${noSpaceDocuments.length} documents (${noSpaceCounts.users} users, ${noSpaceCounts.places} places, ${noSpaceCounts.visits} visits, ${noSpaceCounts.trips} trip, ${noSpaceCounts.contributions} contributions, ${noSpaceCounts.dayOrders} day orders).`);
}

main().catch(error => {
  console.error(`Fixture validation failed: ${error.message}`);
  process.exitCode = 1;
});
