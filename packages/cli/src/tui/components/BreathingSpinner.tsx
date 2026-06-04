import { memo, useEffect, useState } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

const FRAMES = ["◐", "◓", "◑", "◒", "◉", "◒", "◑", "◓"] as const;
const VERBS = ["Thinking", "Planning", "Composing", "Reasoning"] as const;

/**
 * Tick-based spinner. We drive frame / pulse / verb from a single 100ms
 * interval (instead of three independent ones) so React 18's automatic
 * batching collapses the resulting setState calls into one commit per tick.
 *
 * Why this matters: during the thinking phase, the spinner is mounted next
 * to a streaming live region. If we let three setIntervals fire at
 * 140/400/2400 ms, the parent component re-renders up to ~10x/sec, and each
 * re-render diffs every Static item in the history. With a single ticker
 * the parent only commits when the spinner state actually changes.
 */
const TICK_MS = 100;
const FRAME_MOD = 7; // ~14fps frame, slightly slower than 7fps to feel less jittery
const PULSE_MOD = 4; // ~2.5fps pulse
const VERB_MOD = 24; // ~0.4fps verb (~4s per word)

export const BreathingSpinner = memo(function BreathingSpinner(props: {
  label?: string;
  verb?: string;
}) {
  const [frame, setFrame] = useState(0);
  const [pulse, setPulse] = useState(0);
  const [verbIdx, setVerbIdx] = useState(0);

  useEffect(() => {
    let tick = 0;
    const id = setInterval(() => {
      tick += 1;
      setFrame(tick % FRAME_MOD);
      if (tick % PULSE_MOD === 0) {
        setPulse((p) => (p + 1) % theme.spinner.length);
      }
      if (tick % VERB_MOD === 0) {
        setVerbIdx((v) => (v + 1) % VERBS.length);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const color = theme.spinner[pulse]!;
  const label = props.label ?? `${VERBS[verbIdx]}…`;

  return (
    <Box marginY={0} gap={1}>
      <Text color={color} bold>
        {FRAMES[frame]}
      </Text>
      <Text color={color}>{label}</Text>
      {props.verb ? <Text dimColor>{props.verb}</Text> : null}
    </Box>
  );
});
