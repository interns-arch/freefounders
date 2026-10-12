/** "/": Attendance when signed in (the first screen, PLAN.md §19.14), otherwise sign-in. */
import { useClaims } from '@freefounders/core';
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href={useClaims() ? '/attendance' : '/sign-in'} />;
}
