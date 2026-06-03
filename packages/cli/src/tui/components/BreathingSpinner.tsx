import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

const FRAMES = ["◐", "◓", "◑", "◒", "◉", "◒", "◑", "◓"] as const;
const VERBS = ["Thinking", "Planning", "Composing", "Reasoning"] as const;

export function BreathingSpinner(props: { label?: string; verb?: string }) {
  const [frame, setFrame] = useState(0);
  const [verbIdx, setVerbIdx] = useState(0);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const spin = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 140);
    const breathe = setInterval(() => setPulse((p) => (p + 1) % theme.spinner.length), 400);
    const verbs = setInterval(() => setVerbIdx((v) => (v + 1) % VERBS.length), 2400);
    return () => {
      clearInterval(spin);
      clearInterval(breathe);
      clearInterval(verbs);
    };
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
}
