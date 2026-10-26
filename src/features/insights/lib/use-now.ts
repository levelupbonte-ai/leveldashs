'use client';

import { useState } from 'react';

/** Time of the first render, stable across re-renders (keeps render pure). */
export function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}
