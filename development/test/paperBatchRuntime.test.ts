import { strict as assert } from "node:assert";
import {
  createRetryablePersistence,
  createPaperBatchStore,
  createSequentialPaperBatch,
  createZoteroPaperBatchStore,
  type PaperBatchJob,
  type PaperBatchSnapshot,
} from "../src/modules/contextPanel/paperBatchRuntime";

describe("durable sequential paper batch", () => {
  const job = (id: number): PaperBatchJob => ({
    id,
    libraryID: 1,
    itemKey: `KEY${id}`,
    title: `Paper ${id}`,
    state: "queued",
  });
  it("retries a failed save and coalesces concurrent saves", async () => {
    let calls = 0,
      release!: () => void;
    const save = createRetryablePersistence(async () => {
      if (++calls === 1) throw Error("disk full");
      await new Promise<void>((r) => (release = r));
    });
    await assert.rejects(save(), /disk full/);
    const a = save(),
      b = save();
    assert.equal(a, b);
    await Promise.resolve();
    release();
    await a;
    await save();
    assert.equal(calls, 2);
  });
  it("preserves identity, order, expanded prompt and conversation; restores running as interrupted", async () => {
    let raw: string | null = null,
      writes = 0;
    const store = createPaperBatchStore(
      async () => raw,
      async (text) => {
        raw = text;
        writes++;
      },
    );
    const state: PaperBatchSnapshot = {
      prompt: "完整提示词",
      model: "gpt-5.6-luna",
      effort: "max",
      jobs: [{ ...job(1), state: "running", conversationKey: 42 }, job(2)],
    };
    await Promise.all([store.save(state), store.save(state)]);
    assert.equal(writes, 1);
    const loaded = (await store.load())!;
    assert.equal(loaded.jobs[0].state, "interrupted");
    assert.equal(loaded.jobs[0].conversationKey, 42);
    assert.equal(loaded.jobs[1].state, "queued");
    assert.equal(loaded.prompt, state.prompt);
    raw = "{damaged";
    await assert.rejects(store.load());
    assert.equal(raw, "{damaged");
    raw = "";
    await assert.rejects(store.load(), /JSON/);
    assert.equal(
      raw,
      "",
      "an existing empty file is not treated as a new queue",
    );
  });
  it("does not dispatch when the pre-execution checkpoint fails", async () => {
    const jobs = [job(1), job(2)];
    let calls = 0,
      checkpoints = 0;
    const batch = createSequentialPaperBatch(
      jobs,
      async () => {
        calls++;
        return { status: "completed" };
      },
      () => {},
      async () => {
        if (++checkpoints === 1) throw Error("disk full");
      },
    );
    await assert.rejects(batch.run(), /disk full/);
    assert.equal(calls, 0);
    assert.equal(batch.paused, true);
    assert.equal(jobs[0].state, "queued");
    await batch.run();
    assert.equal(calls, 2);
  });
  it("ignores repeated start, continues after one failure and includes tasks appended while running", async () => {
    const jobs = [job(1), job(2)];
    let release!: () => void;
    const executed: number[] = [];
    const batch = createSequentialPaperBatch(jobs, async (j) => {
      executed.push(j.id);
      if (j.id === 1) {
        await new Promise<void>((r) => (release = r));
        throw Error("provider failed");
      }
      return { status: "completed" };
    });
    const running = batch.run();
    await Promise.resolve();
    await batch.run();
    jobs.push(job(3));
    release();
    await running;
    assert.deepEqual(executed, [1, 2, 3]);
    assert.deepEqual(
      jobs.map((j) => j.state),
      ["failed", "completed", "completed"],
    );
  });
  it("honors stop while the disk checkpoint is pending", async () => {
    let release!: () => void;
    const jobs = [job(1)];
    let checkpoints = 0,
      calls = 0;
    const batch = createSequentialPaperBatch(
      jobs,
      async () => {
        calls++;
        return { status: "completed" };
      },
      () => {},
      async () => {
        if (++checkpoints === 1) await new Promise<void>((r) => (release = r));
      },
    );
    const running = batch.run();
    batch.stop();
    release();
    await running;
    assert.equal(calls, 0);
    assert.equal(jobs[0].state, "cancelled");
  });
  it("uses Windows native paths and an atomic temporary file", async () => {
    const oldZ = (globalThis as any).Zotero,
      oldIO = (globalThis as any).IOUtils;
    let target = "",
      tmp = "";
    try {
      (globalThis as any).Zotero = {
        getMainWindow: () => null,
        Profile: { dir: "C:\\Zotero\\Profile" },
      };
      (globalThis as any).IOUtils = {
        exists: async (path: string) => {
          assert.equal(
            path,
            "C:\\Zotero\\Profile\\llmforzotero\\paper-batch-v1.json",
          );
          return false;
        },
        makeDirectory: async () => {},
        writeUTF8: async (
          path: string,
          _text: string,
          opts: { tmpPath: string },
        ) => {
          target = path;
          tmp = opts.tmpPath;
        },
      };
      const store = createZoteroPaperBatchStore();
      assert.equal(await store.load(), null);
      await store.save({
        prompt: "test",
        model: "luna",
        effort: "max",
        jobs: [],
      });
      assert.equal(tmp, target + ".tmp");
    } finally {
      (globalThis as any).Zotero = oldZ;
      (globalThis as any).IOUtils = oldIO;
    }
  });

  it("pauses after the active paper and resumes only the remaining papers", async () => {
    const jobs = [job(1), job(2)];
    let release!: () => void;
    const executed: number[] = [];
    const batch = createSequentialPaperBatch(jobs, async (entry) => {
      executed.push(entry.id);
      if (entry.id === 1)
        await new Promise<void>((resolve) => (release = resolve));
      return { status: "completed" };
    });
    const running = batch.run();
    await Promise.resolve();
    batch.pause();
    release();
    await running;
    assert.deepEqual(executed, [1]);
    assert.deepEqual(
      jobs.map((entry) => entry.state),
      ["completed", "queued"],
    );
    await batch.run();
    assert.deepEqual(executed, [1, 2]);
  });

  it("stops advancing if saving the completed outcome fails, without rerunning that paper", async () => {
    const jobs = [job(1), job(2)];
    const executed: number[] = [];
    let checkpoints = 0;
    const batch = createSequentialPaperBatch(
      jobs,
      async (entry) => {
        executed.push(entry.id);
        return { status: "completed" };
      },
      () => {},
      async () => {
        if (++checkpoints === 2) throw Error("disk full after completion");
      },
    );
    await assert.rejects(batch.run(), /disk full after completion/);
    assert.equal(batch.paused, true);
    assert.deepEqual(executed, [1]);
    await batch.run();
    assert.deepEqual(executed, [1, 2]);
  });

  it("does not automatically dispatch a restored interrupted paper", async () => {
    const saved = JSON.stringify({
      version: 1,
      prompt: "test",
      model: "luna",
      effort: "max",
      jobs: [{ ...job(1), state: "running" }, job(2)],
    });
    const store = createPaperBatchStore(
      async () => saved,
      async () => {},
    );
    const restored = (await store.load())!;
    const executed: number[] = [];
    const batch = createSequentialPaperBatch(restored.jobs, async (entry) => {
      executed.push(entry.id);
      return { status: "completed" };
    });
    await batch.run();
    assert.deepEqual(executed, [2]);
    assert.equal(restored.jobs[0].state, "interrupted");
  });
});
