'use client';
import { useEffect } from 'react';
import { promotePendingMethod } from '../lib/last-method';

/** Mounted on signed-in pages: confirms a Google sign-in started from this tab. */
export function RecordLastMethod() {
  useEffect(() => {
    promotePendingMethod();
  }, []);
  return null;
}
