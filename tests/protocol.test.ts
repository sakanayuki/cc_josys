import { describe, expect, it } from "vitest";
import { asMsg } from "../src/net/protocol";

describe("protocol", () => {
  it("既知のメッセージ型を受け入れる", () => {
    expect(asMsg({ t: "hello", v: 1, name: "a", host: true })).not.toBeNull();
    expect(asMsg({ t: "state", ver: 1, s: {} })).not.toBeNull();
    expect(asMsg({ t: "rematch" })).not.toBeNull();
  });

  it("不正なデータを拒否する", () => {
    expect(asMsg(null)).toBeNull();
    expect(asMsg("hello")).toBeNull();
    expect(asMsg(42)).toBeNull();
    expect(asMsg({})).toBeNull();
    expect(asMsg({ t: "unknown" })).toBeNull();
    expect(asMsg({ t: 5 })).toBeNull();
  });
});
