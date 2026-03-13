import test from "node:test";
import assert from "node:assert/strict";

import { createPrismaJobQueue } from "../../domain/jobs/prisma-job-queue.mjs";

function createQueuePrismaDouble(seedJobs = []) {
  const jobs = seedJobs.map((job, index) => ({
    attempts: 0,
    availableAt: new Date("2026-03-13T00:00:00.000Z"),
    createdAt: new Date(`2026-03-13T00:00:0${index}.000Z`),
    deadLetteredAt: null,
    dedupeKey: null,
    id: `job-${index + 1}`,
    lastError: null,
    leaseExpiresAt: null,
    leaseToken: null,
    leasedAt: null,
    leasedBy: null,
    maxAttempts: 5,
    state: "queued",
    ...job,
    updatedAt: new Date("2026-03-13T00:00:00.000Z"),
  }));
  const attempts = [];
  const leases = [];
  let nextId = jobs.length + 1;

  function compareOrder(orderBy, left, right) {
    for (const clause of orderBy ?? []) {
      const [field, direction] = Object.entries(clause)[0];
      if (left[field] < right[field]) {
        return direction === "asc" ? -1 : 1;
      }

      if (left[field] > right[field]) {
        return direction === "asc" ? 1 : -1;
      }
    }

    return 0;
  }

  function matchesScalarFilter(value, filter) {
    if (filter === undefined) {
      return true;
    }

    if (filter && typeof filter === "object" && !Array.isArray(filter)) {
      if ("in" in filter) {
        return filter.in.includes(value);
      }

      if ("notIn" in filter) {
        return !filter.notIn.includes(value);
      }

      if ("lte" in filter) {
        return value <= filter.lte;
      }

      if ("gt" in filter) {
        return value > filter.gt;
      }
    }

    return value === filter;
  }

  function matchesWhere(job, where) {
    if (!where) {
      return true;
    }

    if (Array.isArray(where.OR)) {
      return where.OR.some((entry) => matchesWhere(job, entry))
        && matchesWhere(job, { ...where, OR: undefined });
    }

    return Object.entries(where).every(([field, filter]) => {
      if (filter === undefined) {
        return true;
      }

      return matchesScalarFilter(job[field], filter);
    });
  }

  function applyJobData(job, data) {
    for (const [field, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in value) {
        job[field] += value.increment;
        continue;
      }

      job[field] = value;
    }

    job.updatedAt = new Date("2026-03-13T00:10:00.000Z");
  }

  return {
    attempts,
    jobs,
    leases,
    async $transaction(callback) {
      return callback(this);
    },
    job: {
      async create({ data }) {
        const duplicate = jobs.find(
          (job) =>
            job.shopDomain === data.shopDomain &&
            job.kind === data.kind &&
            job.dedupeKey === data.dedupeKey &&
            ["queued", "retryable", "leased"].includes(job.state) &&
            data.dedupeKey !== null,
        );

        if (duplicate) {
          const error = new Error("duplicate");
          error.code = "P2002";
          throw error;
        }

        const created = {
          attempts: 0,
          createdAt: new Date("2026-03-13T00:00:00.000Z"),
          deadLetteredAt: null,
          id: `job-${nextId++}`,
          lastError: null,
          leaseExpiresAt: null,
          leaseToken: null,
          leasedAt: null,
          leasedBy: null,
          updatedAt: new Date("2026-03-13T00:00:00.000Z"),
          ...data,
        };
        jobs.push(created);
        return created;
      },
      async findMany({ orderBy, select, where }) {
        const matched = jobs
          .filter((job) => matchesWhere(job, where))
          .sort((left, right) => compareOrder(orderBy, left, right));

        if (select) {
          return matched.map((job) =>
            Object.fromEntries(Object.keys(select).map((field) => [field, job[field]])),
          );
        }

        return matched;
      },
      async findFirst({ orderBy, where }) {
        return jobs
          .filter((job) => matchesWhere(job, where))
          .sort((left, right) => compareOrder(orderBy, left, right))[0] ?? null;
      },
      async findUnique({ where }) {
        return jobs.find((job) => job.id === where.id) ?? null;
      },
      async update({ data, where }) {
        const job = jobs.find((entry) => entry.id === where.id);
        if (!job) {
          throw new Error("job not found");
        }

        applyJobData(job, data);
        return job;
      },
      async updateMany({ data, where }) {
        const matched = jobs.filter((job) => matchesWhere(job, where));
        matched.forEach((job) => applyJobData(job, data));
        return { count: matched.length };
      },
    },
    jobLease: {
      async create({ data }) {
        const existing = leases.find((lease) => lease.shopDomain === data.shopDomain);
        if (existing) {
          const error = new Error("duplicate");
          error.code = "P2002";
          throw error;
        }

        const created = {
          createdAt: new Date("2026-03-13T00:00:00.000Z"),
          jobId: null,
          leaseExpiresAt: null,
          leaseToken: null,
          updatedAt: new Date("2026-03-13T00:00:00.000Z"),
          workerId: null,
          ...data,
        };
        leases.push(created);
        return created;
      },
      async findFirst({ where }) {
        return leases.find((lease) => matchesWhere(lease, where)) ?? null;
      },
      async updateMany({ data, where }) {
        if (Object.keys(data).length === 0) {
          throw new Error("Prisma updateMany requires at least one field in data");
        }

        const matched = leases.filter((lease) => matchesWhere(lease, where));
        matched.forEach((lease) => applyJobData(lease, data));
        return { count: matched.length };
      },
    },
    jobAttempt: {
      async create({ data }) {
        attempts.push({ ...data });
        return data;
      },
      async delete({ where }) {
        const index = attempts.findIndex(
          (entry) =>
            entry.jobId === where.jobId_attemptNumber.jobId &&
            entry.attemptNumber === where.jobId_attemptNumber.attemptNumber,
        );

        if (index === -1) {
          throw new Error("attempt not found");
        }

        const [attempt] = attempts.splice(index, 1);
        return attempt;
      },
      async update({ data, where }) {
        const attempt = attempts.find(
          (entry) =>
            entry.jobId === where.jobId_attemptNumber.jobId &&
            entry.attemptNumber === where.jobId_attemptNumber.attemptNumber,
        );

        Object.assign(attempt, data);
        return attempt;
      },
      async updateMany({ data, where }) {
        const matched = attempts.filter(
          (entry) =>
            (where.jobId === undefined || entry.jobId === where.jobId) &&
            (where.workerId === undefined || entry.workerId === where.workerId) &&
            (where.attemptNumber === undefined || entry.attemptNumber === where.attemptNumber),
        );
        matched.forEach((entry) => Object.assign(entry, data));
        return { count: matched.length };
      },
    },
  };
}

test("job queue enqueues once per dedupe key", async () => {
  const prisma = createQueuePrismaDouble();
  const queue = createPrismaJobQueue(prisma);

  const first = await queue.enqueue({
    dedupeKey: "products:1",
    kind: "product.write",
    payload: { productId: "gid://shopify/Product/1" },
    shopDomain: "example.myshopify.com",
  });
  const duplicate = await queue.enqueue({
    dedupeKey: "products:1",
    kind: "product.write",
    payload: { productId: "gid://shopify/Product/1" },
    shopDomain: "example.myshopify.com",
  });

  assert.equal(first.id, "job-1");
  assert.equal(duplicate, null);
});

test("job queue allows re-enqueue after a terminal job with the same dedupe key", async () => {
  const prisma = createQueuePrismaDouble([
    {
      dedupeKey: "products:1",
      id: "job-completed",
      kind: "product.write",
      payload: { productId: "gid://shopify/Product/1" },
      shopDomain: "example.myshopify.com",
      state: "completed",
    },
  ]);
  const queue = createPrismaJobQueue(prisma);

  const rerun = await queue.enqueue({
    dedupeKey: "products:1",
    kind: "product.write",
    payload: { productId: "gid://shopify/Product/1" },
    shopDomain: "example.myshopify.com",
  });

  assert.equal(rerun.id, "job-2");
});

test("job queue enforces single leased writer per shop", async () => {
  const now = new Date("2026-03-13T01:00:00.000Z");
  const prisma = createQueuePrismaDouble([
    {
      id: "job-a",
      kind: "product.write",
      payload: { id: 1 },
      shopDomain: "a.myshopify.com",
    },
    {
      id: "job-b",
      kind: "product.write",
      payload: { id: 2 },
      shopDomain: "a.myshopify.com",
      createdAt: new Date("2026-03-13T00:00:01.000Z"),
    },
    {
      id: "job-c",
      kind: "product.write",
      payload: { id: 3 },
      shopDomain: "b.myshopify.com",
      createdAt: new Date("2026-03-13T00:00:02.000Z"),
    },
  ]);
  const queue = createPrismaJobQueue(prisma);

  const firstLease = await queue.leaseNext({ now, workerId: "worker-1" });
  const secondLease = await queue.leaseNext({ now, workerId: "worker-2" });

  assert.equal(firstLease.id, "job-a");
  assert.equal(secondLease.id, "job-c");
  assert.equal(prisma.jobs.find((job) => job.id === "job-b").state, "queued");
  assert.equal(prisma.leases.find((lease) => lease.shopDomain === "a.myshopify.com").jobId, "job-a");
});

test("job queue retries and dead-letters after max attempts", async () => {
  const firstNow = new Date("2026-03-13T02:00:00.000Z");
  const secondNow = new Date("2026-03-13T02:05:00.000Z");
  const prisma = createQueuePrismaDouble([
    {
      id: "job-a",
      kind: "inventory.write",
      maxAttempts: 2,
      payload: { id: 1 },
      shopDomain: "a.myshopify.com",
    },
  ]);
  const queue = createPrismaJobQueue(prisma);

  const firstLease = await queue.leaseNext({ now: firstNow, workerId: "worker-1" });
  const firstFailure = await queue.fail({
    delayMs: 60_000,
    errorMessage: "stale inventory",
    jobId: firstLease.id,
    now: firstNow,
    workerId: "worker-1",
  });

  assert.equal(firstFailure.state, "retryable");

  const secondLease = await queue.leaseNext({ now: secondNow, workerId: "worker-2" });
  const secondFailure = await queue.fail({
    errorMessage: "stale inventory again",
    jobId: secondLease.id,
    now: secondNow,
    workerId: "worker-2",
  });

  assert.equal(secondFailure.state, "dead_letter");
  assert.equal(prisma.jobs[0].deadLetteredAt?.toISOString(), secondNow.toISOString());
});

test("expired lease is reclaimable by another worker", async () => {
  const now = new Date("2026-03-13T03:00:00.000Z");
  const prisma = createQueuePrismaDouble([
    {
      attempts: 1,
      id: "job-a",
      kind: "product.write",
      leaseExpiresAt: new Date("2026-03-13T02:59:00.000Z"),
      leasedAt: new Date("2026-03-13T02:55:00.000Z"),
      leasedBy: "worker-1",
      payload: { id: 1 },
      shopDomain: "a.myshopify.com",
      state: "leased",
    },
  ]);
  const queue = createPrismaJobQueue(prisma);

  const lease = await queue.leaseNext({ now, workerId: "worker-2" });

  assert.equal(lease.id, "job-a");
  assert.equal(lease.leasedBy, "worker-2");
  assert.equal(lease.attempts, 2);
});

test("heartbeat extends the shop lease and attempt only while the lease is still valid", async () => {
  const now = new Date("2026-03-13T03:00:00.000Z");
  const prisma = createQueuePrismaDouble([
    {
      attempts: 1,
      id: "job-a",
      kind: "product.write",
      leaseExpiresAt: new Date("2026-03-13T03:01:00.000Z"),
      leaseToken: "lease-active",
      leasedAt: new Date("2026-03-13T02:55:00.000Z"),
      leasedBy: "worker-1",
      payload: { id: 1 },
      shopDomain: "a.myshopify.com",
      state: "leased",
    },
    {
      id: "job-b",
      kind: "product.write",
      payload: { id: 2 },
      shopDomain: "a.myshopify.com",
      state: "queued",
    },
  ]);
  prisma.leases.push({
    shopDomain: "a.myshopify.com",
    jobId: "job-a",
    leaseExpiresAt: new Date("2026-03-13T03:01:00.000Z"),
    leaseToken: "lease-active",
    workerId: "worker-1",
  });
  prisma.attempts.push({
    attemptNumber: 1,
    jobId: "job-a",
    leaseExpiresAt: new Date("2026-03-13T03:01:00.000Z"),
    leaseToken: "lease-active",
    startedAt: new Date("2026-03-13T02:55:00.000Z"),
    workerId: "worker-1",
  });
  const queue = createPrismaJobQueue(prisma);

  const heartbeated = await queue.heartbeat({
    jobId: "job-a",
    leaseMs: 120_000,
    now,
    workerId: "worker-1",
  });

  assert.equal(heartbeated, true);
  assert.equal(prisma.jobs[0].leaseExpiresAt.toISOString(), "2026-03-13T03:02:00.000Z");
  assert.equal(
    prisma.leases.find((lease) => lease.shopDomain === "a.myshopify.com").leaseExpiresAt.toISOString(),
    "2026-03-13T03:02:00.000Z",
  );
  assert.equal(prisma.attempts[0].leaseExpiresAt.toISOString(), "2026-03-13T03:02:00.000Z");
});

test("heartbeat cannot revive an expired lease", async () => {
  const now = new Date("2026-03-13T04:00:00.000Z");
  const prisma = createQueuePrismaDouble([
    {
      attempts: 1,
      id: "job-a",
      kind: "product.write",
      leaseExpiresAt: new Date("2026-03-13T03:59:00.000Z"),
      leaseToken: "lease-expired",
      leasedAt: new Date("2026-03-13T03:55:00.000Z"),
      leasedBy: "worker-1",
      payload: { id: 1 },
      shopDomain: "a.myshopify.com",
      state: "leased",
    },
  ]);
  prisma.leases.push({
    shopDomain: "a.myshopify.com",
    jobId: "job-a",
    leaseExpiresAt: new Date("2026-03-13T03:59:00.000Z"),
    leaseToken: "lease-expired",
    workerId: "worker-1",
  });
  prisma.attempts.push({
    attemptNumber: 1,
    jobId: "job-a",
    leaseExpiresAt: new Date("2026-03-13T03:59:00.000Z"),
    leaseToken: "lease-expired",
    startedAt: new Date("2026-03-13T03:55:00.000Z"),
    workerId: "worker-1",
  });
  const queue = createPrismaJobQueue(prisma);

  const heartbeated = await queue.heartbeat({
    jobId: "job-a",
    leaseMs: 120_000,
    now,
    workerId: "worker-1",
  });

  assert.equal(heartbeated, false);
  assert.equal(prisma.jobs[0].leaseExpiresAt.toISOString(), "2026-03-13T03:59:00.000Z");
  assert.equal(
    prisma.leases.find((lease) => lease.shopDomain === "a.myshopify.com").leaseExpiresAt.toISOString(),
    "2026-03-13T03:59:00.000Z",
  );
});

test("stale worker cannot complete a re-leased job", async () => {
  const now = new Date("2026-03-13T04:00:00.000Z");
  const prisma = createQueuePrismaDouble([
    {
      attempts: 1,
      id: "job-a",
      kind: "product.write",
      leaseExpiresAt: new Date("2026-03-13T03:59:00.000Z"),
      leaseToken: "lease-old",
      leasedAt: new Date("2026-03-13T03:55:00.000Z"),
      leasedBy: "worker-1",
      payload: { id: 1 },
      shopDomain: "a.myshopify.com",
      state: "leased",
    },
  ]);
  prisma.leases.push({
    shopDomain: "a.myshopify.com",
    jobId: "job-a",
    leaseExpiresAt: new Date("2026-03-13T03:59:00.000Z"),
    leaseToken: "lease-old",
    workerId: "worker-1",
  });
  const queue = createPrismaJobQueue(prisma);

  const renewedLease = await queue.leaseNext({ now, workerId: "worker-2" });
  const staleComplete = await queue.complete({
    jobId: "job-a",
    now: new Date("2026-03-13T04:00:01.000Z"),
    workerId: "worker-1",
  });

  assert.equal(renewedLease.leasedBy, "worker-2");
  assert.notEqual(renewedLease.leaseToken, "lease-old");
  assert.equal(staleComplete, false);
  assert.equal(prisma.jobs[0].state, "leased");
  assert.equal(prisma.jobs[0].leasedBy, "worker-2");
});

test("stale worker cannot fail a re-leased job", async () => {
  const now = new Date("2026-03-13T05:00:00.000Z");
  const prisma = createQueuePrismaDouble([
    {
      attempts: 1,
      id: "job-a",
      kind: "product.write",
      leaseExpiresAt: new Date("2026-03-13T04:59:00.000Z"),
      leaseToken: "lease-old",
      leasedAt: new Date("2026-03-13T04:55:00.000Z"),
      leasedBy: "worker-1",
      payload: { id: 1 },
      shopDomain: "a.myshopify.com",
      state: "leased",
    },
  ]);
  prisma.leases.push({
    shopDomain: "a.myshopify.com",
    jobId: "job-a",
    leaseExpiresAt: new Date("2026-03-13T04:59:00.000Z"),
    leaseToken: "lease-old",
    workerId: "worker-1",
  });
  const queue = createPrismaJobQueue(prisma);

  await queue.leaseNext({ now, workerId: "worker-2" });
  const staleFailure = await queue.fail({
    delayMs: 60_000,
    errorMessage: "stale worker",
    jobId: "job-a",
    now: new Date("2026-03-13T05:00:01.000Z"),
    workerId: "worker-1",
  });

  assert.equal(staleFailure, null);
  assert.equal(prisma.jobs[0].state, "leased");
  assert.equal(prisma.jobs[0].leasedBy, "worker-2");
});

test("worker can release an unstarted leased job back to queued during shutdown drain", async () => {
  const now = new Date("2026-03-13T05:30:00.000Z");
  const prisma = createQueuePrismaDouble([
    {
      attempts: 1,
      id: "job-a",
      kind: "product.write",
      leaseExpiresAt: new Date("2026-03-13T05:31:00.000Z"),
      leaseToken: "lease-active",
      leasedAt: new Date("2026-03-13T05:29:00.000Z"),
      leasedBy: "worker-1",
      payload: { id: 1 },
      shopDomain: "a.myshopify.com",
      state: "leased",
    },
  ]);
  prisma.leases.push({
    shopDomain: "a.myshopify.com",
    jobId: "job-a",
    leaseExpiresAt: new Date("2026-03-13T05:31:00.000Z"),
    leaseToken: "lease-active",
    workerId: "worker-1",
  });
  prisma.attempts.push({
    attemptNumber: 1,
    jobId: "job-a",
    leaseExpiresAt: new Date("2026-03-13T05:31:00.000Z"),
    leaseToken: "lease-active",
    startedAt: new Date("2026-03-13T05:29:00.000Z"),
    workerId: "worker-1",
  });
  const queue = createPrismaJobQueue(prisma);

  const released = await queue.release({
    jobId: "job-a",
    now,
    workerId: "worker-1",
  });

  assert.equal(released, true);
  assert.equal(prisma.jobs[0].state, "queued");
  assert.equal(prisma.jobs[0].attempts, 0);
  assert.equal(prisma.jobs[0].leasedBy, null);
  assert.equal(prisma.jobs[0].leaseToken, null);
  assert.equal(prisma.leases[0].jobId, null);
  assert.equal(prisma.attempts.length, 0);
});

test("expired worker cannot complete after its lease timed out even without re-lease", async () => {
  const now = new Date("2026-03-13T06:00:01.000Z");
  const prisma = createQueuePrismaDouble([
    {
      attempts: 1,
      id: "job-a",
      kind: "product.write",
      leaseExpiresAt: new Date("2026-03-13T06:00:00.000Z"),
      leaseToken: "lease-expired",
      leasedAt: new Date("2026-03-13T05:55:00.000Z"),
      leasedBy: "worker-1",
      payload: { id: 1 },
      shopDomain: "a.myshopify.com",
      state: "leased",
    },
  ]);
  prisma.leases.push({
    shopDomain: "a.myshopify.com",
    jobId: "job-a",
    leaseExpiresAt: new Date("2026-03-13T06:00:00.000Z"),
    leaseToken: "lease-expired",
    workerId: "worker-1",
  });
  const queue = createPrismaJobQueue(prisma);

  const completed = await queue.complete({ jobId: "job-a", now, workerId: "worker-1" });

  assert.equal(completed, false);
  assert.equal(prisma.jobs[0].state, "leased");
});

test("expired worker cannot fail after its lease timed out even without re-lease", async () => {
  const now = new Date("2026-03-13T07:00:01.000Z");
  const prisma = createQueuePrismaDouble([
    {
      attempts: 1,
      id: "job-a",
      kind: "product.write",
      leaseExpiresAt: new Date("2026-03-13T07:00:00.000Z"),
      leaseToken: "lease-expired",
      leasedAt: new Date("2026-03-13T06:55:00.000Z"),
      leasedBy: "worker-1",
      payload: { id: 1 },
      shopDomain: "a.myshopify.com",
      state: "leased",
    },
  ]);
  prisma.leases.push({
    shopDomain: "a.myshopify.com",
    jobId: "job-a",
    leaseExpiresAt: new Date("2026-03-13T07:00:00.000Z"),
    leaseToken: "lease-expired",
    workerId: "worker-1",
  });
  const queue = createPrismaJobQueue(prisma);

  const failed = await queue.fail({
    delayMs: 60_000,
    errorMessage: "too late",
    jobId: "job-a",
    now,
    workerId: "worker-1",
  });

  assert.equal(failed, null);
  assert.equal(prisma.jobs[0].state, "leased");
});
