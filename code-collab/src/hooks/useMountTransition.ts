'use client';

import { useState, useEffect } from 'react';

export function useMountTransition(isMounted: boolean, unmountDelay: number) {
  const [hasRendered, setHasRendered] = useState(isMounted);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    if (isMounted && !hasRendered) {
      setHasRendered(true);
      timeoutId = setTimeout(() => setIsActive(true), 50);
    } else if (!isMounted && hasRendered) {
      setIsActive(false);
      timeoutId = setTimeout(() => setHasRendered(false), unmountDelay);
    } else if (isMounted && hasRendered) {
      setIsActive(true);
    }

    return () => clearTimeout(timeoutId);
  }, [isMounted, hasRendered, unmountDelay]);

  return { hasRendered, isActive };
}
