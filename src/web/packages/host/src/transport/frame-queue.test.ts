import { describe, expect, it } from "vitest";
import { FrameQueue } from "./frame-queue.js";

describe("FrameQueue", () => {
  it("starts empty", () => {
    const queue = new FrameQueue<number>(4);

    expect(queue.size).toBe(0);
    expect(queue.take()).toBeUndefined();
  });

  it("delivers in arrival order", () => {
    const queue = new FrameQueue<number>(4);

    queue.offer(1);
    queue.offer(2);
    queue.offer(3);

    expect(queue.take()).toBe(1);
    expect(queue.take()).toBe(2);
    expect(queue.take()).toBe(3);
    expect(queue.take()).toBeUndefined();
    expect(queue.deliveredCount).toBe(3);
  });

  it("keeps measurements a wedged client can still receive", () => {
    // The defect this replaces: a single slot kept only the newest frame, so
    // every displaced batch's readings were lost for good.
    const queue = new FrameQueue<string>(4);

    expect(queue.offer("a")).toBe(false);
    expect(queue.offer("b")).toBe(false);
    expect(queue.offer("c")).toBe(false);

    expect(queue.size).toBe(3);
    expect(queue.droppedCount).toBe(0);
  });

  it("drops the OLDEST frame past its bound and counts it", () => {
    const queue = new FrameQueue<number>(3);

    for (const frame of [1, 2, 3, 4, 5]) queue.offer(frame);

    expect(queue.size).toBe(3);
    expect(queue.droppedCount).toBe(2);
    expect(queue.take()).toBe(3);
    expect(queue.take()).toBe(4);
    expect(queue.take()).toBe(5);
  });

  it("holds falsy frames, which are legitimate payloads", () => {
    const queue = new FrameQueue<number>(2);

    queue.offer(0);

    expect(queue.size).toBe(1);
    expect(queue.take()).toBe(0);
  });
});
