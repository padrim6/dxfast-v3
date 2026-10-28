import { useState, useEffect } from 'react';

/**
 * Custom hook to debounce rapid parameter updates (e.g. slider drag interactions).
 * Amortizes heavy geometry calculations and 3D scene rebuilds natively using React.
 */
export function useDebounce<T>(value: T, delayMs: number = 75): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
