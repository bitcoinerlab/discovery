import { waitFor } from './helpers/waitFor';

afterEach(() => jest.useRealTimers());

test('waitFor returns immediately once the condition is met', async () => {
  const check = jest.fn().mockResolvedValue(undefined);
  await waitFor('the indexed transaction', check);
  expect(check).toHaveBeenCalledTimes(1);
});

test('waitFor retries until the condition is met', async () => {
  jest.useFakeTimers();
  const check = jest
    .fn()
    .mockRejectedValueOnce(new Error('Not indexed yet'))
    .mockResolvedValue(undefined);
  const pending = waitFor('the indexed transaction', check);
  await jest.advanceTimersByTimeAsync(100);
  await pending;
  expect(check).toHaveBeenCalledTimes(2);
});

test('waitFor times out with the condition and last failure', async () => {
  jest.useFakeTimers();
  const check = jest.fn().mockRejectedValue(new Error('Tip is still 432'));
  const rejected = expect(waitFor('block 433', check, 200)).rejects.toThrow(
    'Timed out waiting for block 433: Tip is still 432'
  );
  await jest.advanceTimersByTimeAsync(200);
  await rejected;
});
