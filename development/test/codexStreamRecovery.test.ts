import { strict as assert } from "node:assert";
import { CodexResponsesAgentAdapter } from "../src/agent/model/codexResponses";
import type { AgentStepParams } from "../src/agent/model/adapter";

describe("Codex Responses stream interruption recovery", () => {
  it("discards incomplete tool arguments and resumes only from completed inputs", async () => {
    const saved = (globalThis as any).ztoolkit;
    let attempt = 0,
      released = false;
    const bodies: any[] = [];
    const events = [
      { type: "response.output_text.delta", delta: "partial" },
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "partial-tool",
          call_id: "partial-call",
          name: "note_write",
          arguments: '{"text":',
        },
      },
    ];
    const body = {
      getReader() {
        let i = 0;
        return {
          async read() {
            if (i < events.length)
              return {
                done: false,
                value: new TextEncoder().encode(
                  "data: " + JSON.stringify(events[i++]) + "\n\n",
                ),
              };
            throw Error("Error in input stream");
          },
          releaseLock() {
            released = true;
          },
        };
      },
    };
    (globalThis as any).ztoolkit = {
      getGlobal: (name: string) =>
        name === "fetch"
          ? async (_url: string, init: any) => {
              bodies.push(JSON.parse(init.body));
              return ++attempt === 1
                ? { ok: true, status: 200, body }
                : {
                    ok: true,
                    status: 200,
                    json: async () => ({
                      output: [
                        {
                          type: "message",
                          content: [
                            {
                              type: "output_text",
                              text: "Recovered complete answer",
                            },
                          ],
                        },
                      ],
                    }),
                  };
            }
          : undefined,
    };
    try {
      const adapter = new CodexResponsesAgentAdapter();
      const params: AgentStepParams = {
        request: {
          conversationKey: 1,
          mode: "agent",
          userText: "Analyze this paper",
          authMode: "api_key",
          apiKey: "test",
          apiBase: "https://test.invalid/v1",
          model: "test",
        },
        messages: [{ role: "user", content: "Analyze this paper" }],
        tools: [],
      };
      const first = await adapter.runStep(params);
      assert.equal(first.kind, "incomplete");
      assert.ok(released);
      assert.ok(
        !JSON.stringify((adapter as any).conversationItems).includes(
          "partial-tool",
        ),
      );
      if (first.kind !== "incomplete") throw Error("expected incomplete");
      const second = await adapter.runStep({
        ...params,
        continuationMessages: [
          { role: "user", content: first.recoveryInstruction },
        ],
      });
      assert.equal(second.kind, "final");
      assert.ok(!JSON.stringify(bodies[1]).includes("partial-call"));
    } finally {
      (globalThis as any).ztoolkit = saved;
    }
  });
});
