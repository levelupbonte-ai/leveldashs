'use client';

import { useEffect, useState } from 'react';

/**
 * The visible part of the page on phones: when the keyboard opens, iOS keeps
 * fixed panels full height and the keyboard covers the reply box. Returns the
 * visible height and offset (null when nothing is hidden or on zoom), to size
 * a fixed panel to what the user can see.
 */
export function useVisualViewport(enabled = true) {
  const [box, setBox] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!enabled || !vv) return;
    const update = () => {
      const hidden = window.innerHeight - vv.height;
      setBox(vv.scale <= 1.01 && hidden > 80 ? { height: vv.height, top: vv.offsetTop } : null);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [enabled]);
  return enabled ? box : null;
}
