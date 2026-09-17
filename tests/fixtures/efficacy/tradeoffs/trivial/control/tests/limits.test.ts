import { expect, test } from "bun:test";
import { orderLimit } from "../src/checkout.ts";
test("order limits", () => { expect(orderLimit("standard")).toBe(20); expect(orderLimit("regulated")).toBe(5); expect(orderLimit("unknown")).toBe(20); });
