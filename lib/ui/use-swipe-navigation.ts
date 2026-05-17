"use client";

import type { TouchEvent } from "react";
import { useRef } from "react";

type SwipeTarget = "left" | "right";

export function useSwipeNavigation(onSwipe: (target: SwipeTarget) => void) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);

  return {
    onTouchStart(event: TouchEvent) {
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    },
    onTouchEnd(event: TouchEvent) {
      if (!start.current) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.current.x;
      const dy = touch.clientY - start.current.y;
      const dt = Date.now() - start.current.at;
      start.current = null;

      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.35 || dt > 600) return;
      onSwipe(dx > 0 ? "left" : "right");
    }
  };
}
