// @ts-nocheck -- repository tests run directly under Bun.
import { clearProfileUnauthorized, onProfileUnauthorized, reportProfileAuthResponse } from './profile-auth-state';

const events: string[] = [];
const unsubscribe = onProfileUnauthorized(profileId => events.push(profileId));

reportProfileAuthResponse(500, 'profile-a');
reportProfileAuthResponse(403, 'profile-a');
reportProfileAuthResponse(401, 'profile-a');
reportProfileAuthResponse(401, 'profile-a');
reportProfileAuthResponse(401, 'profile-b');

if (events.join(',') !== 'profile-a,profile-b') throw new Error(`unexpected unauthorized events: ${events}`);

clearProfileUnauthorized('profile-a');
reportProfileAuthResponse(401, 'profile-a');
unsubscribe();
reportProfileAuthResponse(401, 'profile-c');

if (events.join(',') !== 'profile-a,profile-b,profile-a') throw new Error(`unexpected reset behavior: ${events}`);
console.log('profile auth state: revoked tokens are isolated and deduplicated');
