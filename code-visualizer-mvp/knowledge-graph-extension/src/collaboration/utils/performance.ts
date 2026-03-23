/**
 * Performance Utilities
 * 
 * Throttling and debouncing functions for optimizing
 * cursor updates and typing indicators.
 */

/**
 * Throttle function - limits execution to once per interval
 * Perfect for cursor position updates (60fps = ~16ms)
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: NodeJS.Timeout | null = null;

  return function throttled(...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      func(...args);
    } else {
      // Schedule the next call
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        func(...args);
        timeoutId = null;
      }, delay - timeSinceLastCall);
    }
  };
}

/**
 * Debounce function - delays execution until after calls have stopped
 * Perfect for typing indicators
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return function debounced(...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Leading debounce - executes immediately on first call,
 * then waits for delay before allowing next call
 */
export function debounceLeading<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastCall = 0;

  return function debouncedLeading(...args: Parameters<T>) {
    const now = Date.now();

    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      lastCall = Date.now();
      func(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Request Animation Frame throttle - perfect for smooth cursor animations
 * Limits to browser's refresh rate (typically 60fps)
 */
export function rafThrottle<T extends (...args: any[]) => any>(
  func: T
): (...args: Parameters<T>) => void {
  let rafId: number | null = null;
  let latestArgs: Parameters<T> | null = null;

  return function rafThrottled(...args: Parameters<T>) {
    latestArgs = args;

    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        if (latestArgs) {
          func(...latestArgs);
        }
        rafId = null;
        latestArgs = null;
      });
    }
  };
}

/**
 * Batch updates - collects multiple calls and executes once
 * Useful for batching awareness updates
 */
export function batchUpdates<T>(
  func: (items: T[]) => void,
  delay: number
): (item: T) => void {
  let items: T[] = [];
  let timeoutId: NodeJS.Timeout | null = null;

  return function batched(item: T) {
    items.push(item);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func(items);
      items = [];
      timeoutId = null;
    }, delay);
  };
}
