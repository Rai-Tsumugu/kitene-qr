import { describe, expect, it } from "vitest";
import { isSupportScope, randomToken, requestFingerprint, stableStringify, timingSafeEqual } from "../src/core";
import { confirmAttemptFor } from "../src/client-state";
import { MAX_POLL_COUNT, pollingDecision } from "../src/polling";

describe("core security helpers", () => {
  it("creates 256-bit URL-safe tokens", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(randomToken()).not.toBe(token);
  });

  it("accepts only fixed participant choices", () => {
    expect(isSupportScope("entrance")).toBe(true);
    expect(isSupportScope("decline")).toBe(true);
    expect(isSupportScope("<script>")).toBe(false);
  });

  it("stabilizes object key order for idempotency", async () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
    await expect(requestFingerprint({ b: 2, a: 1 })).resolves.toBe(
      await requestFingerprint({ a: 1, b: 2 }),
    );
  });

  it("compares secrets without early length exits", () => {
    expect(timingSafeEqual("same", "same")).toBe(true);
    expect(timingSafeEqual("same", "different")).toBe(false);
  });
});

describe("polling lifecycle", () => {
  it("shows a recoverable paused state after five minutes", () => {
    expect(pollingDecision(MAX_POLL_COUNT - 1, false)).toBe("schedule");
    expect(pollingDecision(MAX_POLL_COUNT, false)).toBe("paused");
    expect(pollingDecision(0, true)).toBe("hidden");
  });
});

describe("host confirm retry state", () => {
  it("reuses the key for the same invite revision and rotates after state changes", () => {
    let sequence = 0;
    const createKey = () => `key-${++sequence}`;
    const first = confirmAttemptFor(null, "invite-a", 1, createKey);
    const retry = confirmAttemptFor(first, "invite-a", 1, createKey);
    const nextRevision = confirmAttemptFor(retry, "invite-a", 2, createKey);
    expect(retry).toBe(first);
    expect(retry.key).toBe("key-1");
    expect(nextRevision.key).toBe("key-2");
  });
});
