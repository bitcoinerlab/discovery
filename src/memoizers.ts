import { shallowEqualArrays } from 'shallow-equal';

/**
 * This function is an extension of memoizee which stores the result of the latest call (cache size one).
 * If the arguments for the current call are the same as the latest call, it will return the same result.
 * If the arguments are different, but the returned Array is shallowly equal to the previous one, it still returns the same object.
 *
 * @template T - The type of input arguments to the function to be memoized.
 * @template R - The type of the return value of the function to be memoized.
 * @param {(...args: T) => R} func - The function to be memoized.
 * @returns {(...args: T) => R} A memoized version of the input function.
 *
 * @example
 * const memoizedFunc = memoizeOneWithShallowArraysCheck(myFunc);
 * const result1 = memoizedFunc(arg1, arg2);
 * const result2 = memoizedFunc(arg1, arg2); // Will return the same object as result1
 * const result3 = memoizedFunc(arg3, arg4); // If the result is shallowly equal to result1, it will still return the same object as result1
 */
export function memoizeOneWithShallowArraysCheck<
  T extends unknown[],
  R extends unknown[]
>(func: (...args: T) => R) {
  let lastArgs: T | null = null;
  let lastResult: R | null = null;

  return (...args: T): R => {
    // If the new args are shallowly equal to the last args, return the last result
    if (lastArgs && lastResult && shallowEqualArrays(lastArgs, args)) {
      return lastResult;
    }
    lastArgs = args;

    const newResult = func(...args);

    if (lastResult && shallowEqualArrays(lastResult, newResult)) {
      // If the new result is shallowly equal to the last result, return the last result
      return lastResult;
    } else {
      lastResult = newResult;

      // Return the new result
      return newResult;
    }
  };
}
