import { ACTUAL_NOTICE_A11Y } from './actual-recipient';
if (ACTUAL_NOTICE_A11Y.role !== 'status' || ACTUAL_NOTICE_A11Y.accessibilityLiveRegion !== 'polite') throw new Error('FAIL: notice is not a polite status');
console.log('actual recipient accessibility: 1/1 checks passed');
