"use client";

import { useEffect, useRef } from "react";
import { bumpForumViewAction } from "@/lib/forum/actions";

/** Bumps the topic's view counter once per mount. Renders nothing. */
export function ViewPing({ topicId }: { topicId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void bumpForumViewAction(topicId);
  }, [topicId]);
  return null;
}
