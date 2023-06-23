import memoizee from 'memoizee';
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
  let lastResult: R | null = null;

  return memoizee(
    (...args: T) => {
      const newResult = func(...args);

      if (lastResult && shallowEqualArrays(lastResult, newResult)) {
        return lastResult;
      }

      lastResult = newResult;
      return newResult;
    },
    { max: 1 }
  );
}

/**
 * This function is an extension of memoizee which stores the result of the latest call (cache size one).
 * If the arguments for the current call are the same as the latest call, it will return the same result.
 * If the arguments are different, but the returned Object or Array is deeply equal to the previous one, it still returns the same object.
 * Note: This uses JSON.stringify for deep comparisons which might not be suitable for large objects or arrays.
 *
 * @template T - The type of input arguments to the function to be memoized.
 * @template R - The type of the return value of the function to be memoized.
 * @param {(...args: T) => R} func - The function to be memoized.
 * @returns {(...args: T) => R} A memoized version of the input function.
 *
 * @example
 * const memoizedFunc = memoizeOneWithDeepCheck(myFunc);
 * const result1 = memoizedFunc(arg1, arg2);
 * const result2 = memoizedFunc(arg1, arg2); // Will return the same object as result1
 * const result3 = memoizedFunc(arg3, arg4); // If the result is deeply equal to result1, it will still return the same object as result1
 */
export function memoizeOneWithDeepCheck<
  T extends unknown[],
  R extends unknown[]
>(func: (...args: T) => R) {
  let lastResult: R | null = null;

  return memoizee(
    (...args: T) => {
      const newResult = func(...args);

      if (
        lastResult &&
        JSON.stringify(lastResult) === JSON.stringify(newResult)
      ) {
        return lastResult;
      }

      lastResult = newResult;
      return newResult;
    },
    { max: 1 }
  );
}
