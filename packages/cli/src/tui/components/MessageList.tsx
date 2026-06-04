import { Box, Text } from "ink";
import type { ChatLine } from "./message-types.js";
import { MessageRow } from "./MessageRow.js";

export type { ChatLine } from "./message-types.js";

/** @deprecated Use Static + live region in ReplApp; kept for tests. */
export function MessageList(props: {
  messages: ChatLine[];
  maxLines?: number;
  thinkingExpanded?: boolean;
}) {
  const max = props.maxLines ?? 14;
  const slice = props.messages.slice(-max);
  const thinkingExpanded = props.thinkingExpanded ?? false;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {slice.length === 0 ? (
        <Text dimColor>Send a message or type / for commands</Text>
      ) : (
        slice.map((msg) => (
          <MessageRow key={msg.id} message={msg} thinkingExpanded={thinkingExpanded} />
        ))
      )}
    </Box>
  );
}
