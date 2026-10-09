/**
 * Runs a list of asynchronous jobs with a concurrency limit.
 * Does not reject early on individual job failure so that partial batches succeed.
 * Returns the first error encountered, if any.
 *
 * @param {Array<() => Promise<void>>} jobs
 * @param {number} size - Maximum concurrent workers
 * @returns {Promise<Error | null>}
 */
export async function runPool(jobs, size = 8) {
  let i = 0;
  let firstError = null;
  const workerCount = Math.min(size, jobs.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      try {
        await job();
      } catch (err) {
        firstError = firstError || err;
      }
    }
  });
  await Promise.all(workers);
  return firstError;
}
