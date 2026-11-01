import type { Pending } from "../../../src/protocol/index.js";
import {
  initialSlice,
  reduce,
  type AgentSignal,
  type StateSlice,
} from "../../../src/daemon/sessions/state.js";

const q: Pending = {
  kind: "question",
  id: "q1",
  text: "Which?",
  multiSelect: false,
  allowsText: true,
  options: [{ label: "A" }],
};

describe("reduce", () => {
  it("turn_start moves idle to working", () =>
    expect(reduce(initialSlice, { kind: "turn_start" }).slice.state).toBe("working"));

  it("pending moves working to needs_input and notifies", () => {
    const r = reduce({ ...initialSlice, state: "working" }, { kind: "pending", pending: q });
    expect(r.slice.state).toBe("needs_input");
    expect(r.slice.pending).toEqual(q);
    expect(r.notify).toBe("needs_input");
  });

  it("pending_cleared returns to working and drops pending", () => {
    const r = reduce(
      { ...initialSlice, state: "needs_input", pending: q },
      { kind: "pending_cleared", pendingId: "q1" },
    );
    expect(r.slice.state).toBe("working");
    expect(r.slice.pending).toBeUndefined();
  });

  it("turn_end with no sub-agents moves to finished with lastMessage and notifies", () => {
    const r = reduce(
      { ...initialSlice, state: "working" },
      { kind: "turn_end", lastMessage: "Done." },
    );
    expect(r.slice).toMatchObject({ state: "finished", lastMessage: "Done." });
    expect(r.notify).toBe("finished");
  });

  it("turn_end while a sub-agent runs is ignored (no notify)", () => {
    const r = reduce(
      { ...initialSlice, state: "working", subagentsRunning: 1 },
      { kind: "turn_end" },
    );
    expect(r.slice.state).toBe("working");
    expect(r.notify).toBeUndefined();
  });

  it("subagent_start/stop count and stop notifies subagent_finished, never below zero", () => {
    const s = reduce({ ...initialSlice, state: "working" }, { kind: "subagent_start" }).slice;
    expect(s.subagentsRunning).toBe(1);
    const r = reduce(s, { kind: "subagent_stop" });
    expect(r.slice.subagentsRunning).toBe(0);
    expect(r.notify).toBe("subagent_finished");
    expect(reduce(r.slice, { kind: "subagent_stop" }).slice.subagentsRunning).toBe(0);
  });

  it("user_input moves finished to idle and leaves working alone", () => {
    expect(reduce({ ...initialSlice, state: "finished" }, { kind: "user_input" }).slice.state).toBe(
      "idle",
    );
    expect(reduce({ ...initialSlice, state: "working" }, { kind: "user_input" }).slice.state).toBe(
      "working",
    );
  });

  it("process_exit moves any state to ended, clears pending, records exitCode", () => {
    const r = reduce(
      { ...initialSlice, state: "needs_input", pending: q },
      { kind: "process_exit", exitCode: 1 },
    );
    expect(r.slice).toMatchObject({ state: "ended", exitCode: 1 });
    expect(r.slice.pending).toBeUndefined();
  });

  it("ended ignores every other signal", () => {
    const ended: StateSlice = { ...initialSlice, state: "ended", exitCode: 0 };
    for (const sig of [
      { kind: "turn_start" },
      { kind: "pending", pending: q },
      { kind: "user_input" },
    ] as AgentSignal[]) {
      expect(reduce(ended, sig).slice).toEqual(ended);
    }
  });

  describe("controller rulings", () => {
    it("pending from idle or finished moves to needs_input and notifies", () => {
      for (const state of ["idle", "finished"] as const) {
        const r = reduce({ ...initialSlice, state }, { kind: "pending", pending: q });
        expect(r.slice.state).toBe("needs_input");
        expect(r.notify).toBe("needs_input");
      }
    });

    it("turn_start from finished or needs_input moves to working and clears pending", () => {
      for (const state of ["finished", "needs_input"] as const) {
        const r = reduce({ ...initialSlice, state, pending: q }, { kind: "turn_start" });
        expect(r.slice.state).toBe("working");
        expect(r.slice.pending).toBeUndefined();
      }
    });

    it("turn_end clears pending and keeps lastMessage when the signal has none", () => {
      const r = reduce(
        { ...initialSlice, state: "needs_input", pending: q, lastMessage: "old" },
        { kind: "turn_end" },
      );
      expect(r.slice.state).toBe("finished");
      expect(r.slice.pending).toBeUndefined();
      expect(r.slice.lastMessage).toBe("old");
    });

    it("turn_end while already finished does not notify again but takes a new lastMessage", () => {
      const finished: StateSlice = { ...initialSlice, state: "finished", lastMessage: "first" };
      const r = reduce(finished, { kind: "turn_end", lastMessage: "second" });
      expect(r.slice).toEqual({ ...finished, lastMessage: "second" });
      expect(r.notify).toBeUndefined();
      const bare = reduce(finished, { kind: "turn_end" });
      expect(bare.slice).toEqual(finished);
      expect(bare.notify).toBeUndefined();
    });

    it("turn_end while a sub-agent runs leaves pending unchanged", () => {
      const slice: StateSlice = {
        ...initialSlice,
        state: "needs_input",
        pending: q,
        subagentsRunning: 2,
      };
      const r = reduce(slice, { kind: "turn_end", lastMessage: "x" });
      expect(r.slice).toEqual(slice);
      expect(r.notify).toBeUndefined();
    });

    it("pending_cleared with a mismatched pendingId is ignored", () => {
      const slice: StateSlice = { ...initialSlice, state: "needs_input", pending: q };
      const r = reduce(slice, { kind: "pending_cleared", pendingId: "other" });
      expect(r.slice).toEqual(slice);
    });

    it("pending_cleared without a pendingId always clears", () => {
      const r = reduce(
        { ...initialSlice, state: "needs_input", pending: q },
        { kind: "pending_cleared" },
      );
      expect(r.slice.state).toBe("working");
      expect(r.slice.pending).toBeUndefined();
    });

    it("pending_cleared with no pending is a no-op", () => {
      const slice: StateSlice = { ...initialSlice, state: "working" };
      expect(reduce(slice, { kind: "pending_cleared" }).slice).toEqual(slice);
    });

    it("user_input leaves a pending question alone", () => {
      const slice: StateSlice = { ...initialSlice, state: "needs_input", pending: q };
      expect(reduce(slice, { kind: "user_input" }).slice).toEqual(slice);
    });

    it("user_input answers a permission prompt: back to working, pending dropped, no notify", () => {
      const permission: Pending = { kind: "permission", id: "perm-1", tool: "Bash", summary: "x" };
      const slice: StateSlice = { ...initialSlice, state: "needs_input", pending: permission };
      const r = reduce(slice, { kind: "user_input" });
      expect(r.slice).toEqual({ state: "working", subagentsRunning: 0 });
      expect(r.notify).toBeUndefined();
    });

    it("turn_abort returns any live state to idle, clearing pending and sub-agents, without notify", () => {
      const slices: StateSlice[] = [
        { state: "working", subagentsRunning: 1, lastMessage: "m" },
        { state: "needs_input", pending: q, subagentsRunning: 0 },
        { state: "finished", subagentsRunning: 0, lastMessage: "m" },
        initialSlice,
      ];
      for (const slice of slices) {
        const r = reduce(slice, { kind: "turn_abort" });
        expect(r.slice.state).toBe("idle");
        expect(r.slice.pending).toBeUndefined();
        expect(r.slice.subagentsRunning).toBe(0);
        expect(r.slice.lastMessage).toBe(slice.lastMessage);
        expect(r.notify).toBeUndefined();
      }
    });

    it("turn_abort leaves an ended session ended", () => {
      const slice: StateSlice = { state: "ended", subagentsRunning: 0, exitCode: 1 };
      expect(reduce(slice, { kind: "turn_abort" }).slice).toEqual(slice);
    });

    it("subagent_stop at zero stays at zero and does not notify", () => {
      const r = reduce(initialSlice, { kind: "subagent_stop" });
      expect(r.slice.subagentsRunning).toBe(0);
      expect(r.notify).toBeUndefined();
    });

    it("pending with the same id as the current pending is a no-op without notify", () => {
      const slice: StateSlice = { ...initialSlice, state: "needs_input", pending: q };
      const r = reduce(slice, { kind: "pending", pending: { ...q } });
      expect(r.slice).toEqual(slice);
      expect(r.slice).not.toBe(slice);
      expect(r.notify).toBeUndefined();
    });

    it("pending with a different id replaces the pending and notifies", () => {
      const q2: Pending = { ...q, id: "q2", text: "Again?" };
      const r = reduce(
        { ...initialSlice, state: "needs_input", pending: q },
        { kind: "pending", pending: q2 },
      );
      expect(r.slice.pending).toEqual(q2);
      expect(r.notify).toBe("needs_input");
    });

    it("reduce does not mutate its input", () => {
      const slice: StateSlice = { ...initialSlice, state: "needs_input", pending: q };
      const copy = structuredClone(slice);
      const r = reduce(slice, { kind: "turn_end", lastMessage: "m" });
      expect(slice).toEqual(copy);
      expect(r.slice).not.toBe(slice);
    });

    it("agent_exit returns any live state to idle, clearing pending and sub-agents, without notify", () => {
      const slice: StateSlice = {
        state: "needs_input",
        pending: q,
        subagentsRunning: 2,
        lastMessage: "m",
      };
      const r = reduce(slice, { kind: "agent_exit" });
      expect(r.slice).toEqual({ state: "idle", subagentsRunning: 0, lastMessage: "m" });
      expect(r.notify).toBeUndefined();
      expect(
        reduce({ ...initialSlice, state: "working" }, { kind: "agent_exit" }).slice.state,
      ).toBe("idle");
    });

    it("agent_exit leaves an ended session ended", () => {
      const slice: StateSlice = { state: "ended", subagentsRunning: 0, exitCode: 1 };
      expect(reduce(slice, { kind: "agent_exit" }).slice).toEqual(slice);
    });
  });
});
