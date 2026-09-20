import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { watchlistMatch } from "./watchlist.ts";

describe("watchlist matching", () => {
  it("matches a full name regardless of case and punctuation", () => {
    assert.equal(watchlistMatch("VIKTOR HALE", ["Viktor Hale"]), "Viktor Hale");
    assert.equal(watchlistMatch("Hale, Viktor", ["Viktor Hale"]), "Viktor Hale");
  });

  it("matches when the document carries extra given names", () => {
    assert.equal(watchlistMatch("Viktor Anton Hale", ["Viktor Hale"]), "Viktor Hale");
  });

  it("does not match on a partial token", () => {
    // The previous two-way substring test flagged this.
    assert.equal(watchlistMatch("Alistair Cole", ["Ali"]), null);
    assert.equal(watchlistMatch("Amira Cole", ["Mira Solano"]), null);
  });

  it("does not let a one-character entry flag everyone", () => {
    assert.equal(watchlistMatch("Rahul Sharma", ["A"]), null);
  });

  it("requires every token of the entry to be present", () => {
    assert.equal(watchlistMatch("Viktor Nolan", ["Viktor Hale"]), null);
  });

  it("returns null for a missing or empty name", () => {
    assert.equal(watchlistMatch(null, ["Viktor Hale"]), null);
    assert.equal(watchlistMatch("", ["Viktor Hale"]), null);
    assert.equal(watchlistMatch("   ", ["Viktor Hale"]), null);
  });

  it("ignores blank watchlist entries", () => {
    assert.equal(watchlistMatch("Rahul Sharma", ["", "  "]), null);
  });

  it("returns the first matching entry", () => {
    assert.equal(
      watchlistMatch("Viktor Hale", ["Viktor Hale", "Hale"]),
      "Viktor Hale",
    );
  });
});
