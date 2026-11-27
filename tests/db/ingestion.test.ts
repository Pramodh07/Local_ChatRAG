import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestDatabase, TEST_USERS, embedding, seedTwoUsers } from "./harness";

const ALICE = TEST_USERS.alice.id;
const BOB = TEST_USERS.bob.id;

type EnqueueRow = {
  document_id: string;
  version_id: string;
  job_id: string;
  status: string;
  duplicate: boolean;
};

type JobRow = {
  job_id: string;
  owner_id: string;
  document_id: string;
  version_id: string;
  attempts: number;
  max_attempts: number;
  storage_key: string;
  original_name: string;
  mime_type: string;
  chunk_size: number;
};

function ids(seed: number) {
  const suffix = String(seed).padStart(12, "0");
  return {
    documentId: `a0000000-0000-4000-8000-${suffix}`,
    versionId: `b0000000-0000-4000-8000-${suffix}`,
    jobId: `c0000000-0000-4000-8000-${suffix}`,
  };
}

function checksum(seed: number): string {
  return seed.toString(16).padStart(64, "0");
}

async function enqueue(
  db: TestDatabase,
  ownerId: string,
  input: {
    documentId: string;
    versionId: string;
    jobId: string;
    checksum: string;
    name?: string;
    mimeType?: string;
    chunkSize?: number;
  },
): Promise<EnqueueRow> {
  const size = 12;
  return db.runAs(
    "authenticated",
    ownerId,
    async (scoped) => {
      const [row] = await scoped.query<EnqueueRow>(
        `select * from public.enqueue_document_ingestion(
           $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::bigint, $8, $9
         )`,
        [
          input.documentId,
          input.versionId,
          input.jobId,
          input.name ?? "notes.txt",
          input.mimeType ?? "text/plain",
          `${ownerId}/${input.documentId}/${input.versionId}`,
          size,
          input.checksum,
          input.chunkSize ?? 1200,
        ],
      );
      return row;
    },
    { commit: true },
  );
}

function claim(db: TestDatabase, ownerId: string, limit = 5) {
  // Claiming is a service-role worker operation (migration 0010).
  return db.runAs(
    "service_role",
    ownerId,
    (scoped) =>
      scoped.query<JobRow>(
        `select * from public.claim_ingestion_jobs('worker-1', $1)`,
        [limit],
      ),
    { commit: true },
  );
}

describe("durable ingestion queue", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await TestDatabase.create();
    await seedTwoUsers(db);
  }, 60_000);

  // Each test commits queue state, so start from a clean document graph while
  // keeping the seeded accounts.
  beforeEach(async () => {
    await db.exec(
      `delete from public.storage_cleanup_queue;
       delete from public.documents;`,
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("creates a queued document, version, and job, then deduplicates by checksum", async () => {
    const first = ids(1);
    const digest = checksum(1);
    const created = await enqueue(db, ALICE, { ...first, checksum: digest });

    expect(created).toEqual({
      document_id: first.documentId,
      version_id: first.versionId,
      job_id: first.jobId,
      status: "queued",
      duplicate: false,
    });

    const [state] = await db.query<{
      status: string;
      chunk_count: number;
      current_version_id: string | null;
    }>(
      `select status, chunk_count, current_version_id
       from public.documents where id = $1`,
      [first.documentId],
    );
    expect(state).toEqual({
      status: "queued",
      chunk_count: 0,
      current_version_id: first.versionId,
    });

    // A second upload of identical bytes returns the original document and job
    // instead of creating a second copy.
    const second = ids(2);
    const duplicated = await enqueue(db, ALICE, { ...second, checksum: digest });
    expect(duplicated).toEqual({
      document_id: first.documentId,
      version_id: first.versionId,
      job_id: first.jobId,
      status: "queued",
      duplicate: true,
    });

    const [counts] = await db.query<{ versions: number; jobs: number }>(
      `select
         (select count(*)::int from public.document_versions
          where owner_id = $1 and checksum_sha256 = $2) as versions,
         (select count(*)::int from public.ingestion_jobs
          where owner_id = $1 and version_id = $3) as jobs`,
      [ALICE, digest, first.versionId],
    );
    expect(counts).toEqual({ versions: 1, jobs: 1 });
  });

  it("claims, indexes, and only exposes a document after completion", async () => {
    const target = ids(10);
    await enqueue(db, ALICE, { ...target, checksum: checksum(10) });

    const [job] = await claim(db, ALICE, 1);
    expect(job).toMatchObject({
      job_id: target.jobId,
      document_id: target.documentId,
      version_id: target.versionId,
      attempts: 1,
      max_attempts: 3,
      original_name: "notes.txt",
      mime_type: "text/plain",
      chunk_size: 1200,
    });

    const hidden = await db.runAs("authenticated", ALICE, (scoped) =>
      scoped.query(
        `select * from public.match_documents($1::extensions.vector, 5, 0.25)`,
        [embedding(0)],
      ),
    );
    expect(hidden).toEqual([]);

    await db.runAs(
      "service_role",
      ALICE,
      async (scoped) => {
        const [attempt] = await scoped.query<{ document_id: string; version_id: string }>(
          `select document_id, version_id from public.begin_ingestion_attempt($1::uuid)`,
          [target.jobId],
        );
        expect(attempt).toEqual({
          document_id: target.documentId,
          version_id: target.versionId,
        });

        await scoped.query(
          `insert into public.document_chunks
             (document_id, version_id, chunk_index, page, content, content_hash,
              embedding, embedding_model)
           values ($1, $2, 0, 1, 'Indexed content', 'hash-1', $3::extensions.vector,
                   'text-embedding-3-small')`,
          [target.documentId, target.versionId, embedding(0)],
        );

        await scoped.query(
          `select public.complete_ingestion_job($1::uuid, 1, 1, 'text-embedding-3-small')`,
          [target.jobId],
        );
      },
      { commit: true },
    );

    const [document] = await db.query<{ status: string; chunk_count: number }>(
      `select status, chunk_count from public.documents where id = $1`,
      [target.documentId],
    );
    expect(document).toEqual({ status: "ready", chunk_count: 1 });

    const [jobAfter] = await db.query<{ status: string; stage: string; completed_at: string | null }>(
      `select status, stage, completed_at from public.ingestion_jobs where id = $1`,
      [target.jobId],
    );
    expect(jobAfter?.status).toBe("succeeded");
    expect(jobAfter?.stage).toBe("done");
    expect(jobAfter?.completed_at).not.toBeNull();

    const visible = await db.runAs("authenticated", ALICE, (scoped) =>
      scoped.query<{ document_id: string; content: string }>(
        `select document_id, content
         from public.match_documents($1::extensions.vector, 5, 0.25)`,
        [embedding(0)],
      ),
    );
    expect(visible).toEqual([
      { document_id: target.documentId, content: "Indexed content" },
    ]);
  });

  it("backs off retryable failures and keeps a failed document out of retrieval", async () => {
    const target = ids(20);
    await enqueue(db, ALICE, { ...target, checksum: checksum(20) });

    await claim(db, ALICE, 1);
    const firstOutcome = await db.runAs(
      "service_role",
      ALICE,
      (scoped) =>
        scoped.query<{ status: string }>(
          `select public.fail_ingestion_job($1::uuid, 'provider down', true) as status`,
          [target.jobId],
        ),
      { commit: true },
    );
    expect(firstOutcome).toEqual([{ status: "queued" }]);

    const [queued] = await db.query<{ status: string; last_error: string; due: boolean }>(
      `select status, last_error, available_at > now() as due
       from public.ingestion_jobs where id = $1`,
      [target.jobId],
    );
    expect(queued).toMatchObject({ status: "queued", last_error: "provider down" });
    expect(queued?.due).toBe(true);

    // A retry is not claimed before its backoff deadline.
    expect(await claim(db, ALICE, 5)).toEqual([]);

    await db.query(
      `update public.ingestion_jobs
       set available_at = now() - interval '1 second'
       where id = $1`,
      [target.jobId],
    );

    const [secondClaim] = await claim(db, ALICE, 1);
    expect(secondClaim?.attempts).toBe(2);

    const terminal = await db.runAs(
      "service_role",
      ALICE,
      (scoped) =>
        scoped.query<{ status: string }>(
          `select public.fail_ingestion_job($1::uuid, 'bad document', false) as status`,
          [target.jobId],
        ),
      { commit: true },
    );
    expect(terminal).toEqual([{ status: "failed" }]);

    const [document] = await db.query<{ status: string }>(
      `select status from public.documents where id = $1`,
      [target.documentId],
    );
    expect(document?.status).toBe("failed");

    const hidden = await db.runAs("authenticated", ALICE, (scoped) =>
      scoped.query(
        `select * from public.match_documents($1::extensions.vector, 5, 0.25)`,
        [embedding(0)],
      ),
    );
    expect(hidden).toEqual([]);

    const retried = await db.runAs(
      "authenticated",
      ALICE,
      (scoped) =>
        scoped.query<{ retried: boolean }>(
          `select public.retry_ingestion_job($1::uuid) as retried`,
          [target.jobId],
        ),
      { commit: true },
    );
    expect(retried).toEqual([{ retried: true }]);

    const [requeued] = await db.query<{ status: string; attempts: number }>(
      `select status, attempts from public.ingestion_jobs where id = $1`,
      [target.jobId],
    );
    expect(requeued).toEqual({ status: "queued", attempts: 0 });
    expect((await claim(db, ALICE, 1))[0]?.attempts).toBe(1);
  });

  it("isolates versions, jobs, claims, and duplicates by owner", async () => {
    const aliceTarget = ids(30);
    const digest = checksum(30);
    await enqueue(db, ALICE, { ...aliceTarget, checksum: digest });

    const visibleVersions = await db.runAs("authenticated", BOB, (scoped) =>
      scoped.query(
        `select id from public.document_versions where owner_id = $1`,
        [ALICE],
      ),
    );
    const visibleJobs = await db.runAs("authenticated", BOB, (scoped) =>
      scoped.query(`select id from public.ingestion_jobs`),
    );
    expect(visibleVersions).toEqual([]);
    expect(visibleJobs).toEqual([]);

    // The service-role worker can see every owner's jobs; browser roles cannot
    // call the claim RPC at all (migration 0010).
    expect((await claim(db, BOB, 5)).map((job) => job.job_id)).toEqual([
      aliceTarget.jobId,
    ]);
    await expect(
      db.runAs("authenticated", BOB, (scoped) =>
        scoped.query(`select * from public.claim_ingestion_jobs('worker-1', 5)`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.runAs("authenticated", BOB, (scoped) =>
        scoped.query(`select * from public.begin_ingestion_attempt($1::uuid)`, [
          aliceTarget.jobId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);

    await expect(
      db.runAs("authenticated", BOB, (scoped) =>
        scoped.query(`select * from public.delete_document_for_owner($1::uuid)`, [
          aliceTarget.documentId,
        ]),
      ),
    ).rejects.toThrow(/Document not found/);

    // The checksum uniqueness is per owner: Bob uploading the same bytes gets
    // his own private document.
    const bobTarget = ids(31);
    const bobEnqueued = await enqueue(db, BOB, { ...bobTarget, checksum: digest });
    expect(bobEnqueued).toMatchObject({
      document_id: bobTarget.documentId,
      duplicate: false,
    });

    const [counts] = await db.query<{ versions: number }>(
      `select count(*)::int as versions
       from public.document_versions where checksum_sha256 = $1`,
      [digest],
    );
    expect(counts?.versions).toBe(2);
  });

  it("queues private object deletion when a document is removed", async () => {
    const target = ids(40);
    await enqueue(db, ALICE, { ...target, checksum: checksum(40) });

    const deleted = await db.runAs(
      "authenticated",
      ALICE,
      (scoped) =>
        scoped.query<{ deleted: number }>(
          `select public.delete_document_for_owner($1::uuid) as deleted`,
          [target.documentId],
        ),
      { commit: true },
    );
    expect(deleted).toEqual([{ deleted: 1 }]);

    const [remaining] = await db.query<{
      documents: number;
      versions: number;
      jobs: number;
      queued: number;
    }>(
      `select
         (select count(*)::int from public.documents where id = $1) as documents,
         (select count(*)::int from public.document_versions where id = $2) as versions,
         (select count(*)::int from public.ingestion_jobs where id = $3) as jobs,
         (select count(*)::int from public.storage_cleanup_queue where owner_id = $4) as queued`,
      [target.documentId, target.versionId, target.jobId, ALICE],
    );
    expect(remaining).toEqual({ documents: 0, versions: 0, jobs: 0, queued: 1 });

    // Browser roles cannot drain the cleanup queue at all (migration 0010).
    await expect(
      db.runAs("authenticated", BOB, (scoped) =>
        scoped.query(`select * from public.claim_storage_cleanup(10)`),
      ),
    ).rejects.toThrow(/permission denied/);

    const cleanup = await db.runAs(
      "service_role",
      ALICE,
      async (scoped) => {
        const items = await scoped.query<{ id: number; storage_key: string }>(
          `select * from public.claim_storage_cleanup(10)`,
        );
        for (const item of items) {
          await scoped.query(`select public.complete_storage_cleanup($1::bigint)`, [
            item.id,
          ]);
        }
        return items;
      },
      { commit: true },
    );
    expect(cleanup).toEqual([
      {
        id: expect.any(Number),
        storage_key: `${ALICE}/${target.documentId}/${target.versionId}`,
      },
    ]);

    const [after] = await db.query<{ queued: number }>(
      `select count(*)::int as queued
       from public.storage_cleanup_queue where owner_id = $1`,
      [ALICE],
    );
    expect(after?.queued).toBe(0);
  });

  it("rejects invalid checksums and browser access to worker RPCs", async () => {
    const target = ids(50);

    await expect(
      db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query(
          `select * from public.enqueue_document_ingestion(
             $1::uuid, $2::uuid, $3::uuid, 'notes.txt', 'text/plain',
             'key', 10, 'not-a-checksum', 1200
           )`,
          [target.documentId, target.versionId, target.jobId],
        ),
      ),
    ).rejects.toThrow(/SHA-256 checksum/);

    await expect(
      db.runAs("authenticated", null, (scoped) =>
        scoped.query(`select * from public.claim_ingestion_jobs('worker-1', 1)`),
      ),
    ).rejects.toThrow(/permission denied/);

    await expect(
      db.runAs("authenticated", null, (scoped) =>
        scoped.query(`select * from public.claim_storage_cleanup(1)`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("allows the trusted service-role worker to claim jobs across owners", async () => {
    const aliceJob = ids(71);
    const bobJob = ids(72);
    await enqueue(db, ALICE, { ...aliceJob, checksum: checksum(71) });
    await enqueue(db, BOB, { ...bobJob, checksum: checksum(72) });

    const claimed = await db.runAs(
      "service_role",
      null,
      (scoped) =>
        scoped.query<{ owner_id: string; job_id: string }>(
          `select owner_id, job_id
           from public.claim_ingestion_jobs('scheduled-worker', 5)`,
        ),
      { commit: true },
    );

    expect(new Set(claimed.map((job) => job.owner_id))).toEqual(new Set([ALICE, BOB]));
    expect(claimed.map((job) => job.job_id)).toEqual(
      expect.arrayContaining([aliceJob.jobId, bobJob.jobId]),
    );
  });

  it("lets the service-role worker renew a lease but not browser roles", async () => {
    const target = ids(73);
    await enqueue(db, ALICE, { ...target, checksum: checksum(73) });
    await claim(db, ALICE, 1);

    const renewed = await db.runAs(
      "service_role",
      null,
      (scoped) =>
        scoped.query<{ renewed: boolean }>(
          `select public.renew_ingestion_lease($1::uuid) as renewed`,
          [target.jobId],
        ),
      { commit: true },
    );
    expect(renewed).toEqual([{ renewed: true }]);

    await expect(
      db.runAs("authenticated", ALICE, (scoped) =>
        scoped.query(`select public.renew_ingestion_lease($1::uuid)`, [target.jobId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
