import { Box, Text } from "ink";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { theme } from "../theme.js";
import type { ChatLine } from "./MessageList.js";

export function MessageRow(props: {
  message: ChatLine;
  thinkingExpanded?: boolean;
}) {
  const { message, thinkingExpanded = false } = props;

  if (message.role === "system") {
    return (
      <Box marginY={0}>
        <Text color={theme.system} dimColor>
          ◆ {message.text}
        </Text>
      </Box>
    );
  }

  if (message.role === "thinking") {
    return (
      <ThinkingBlock
        text={message.text}
        streaming={message.streaming}
        expanded={thinkingExpanded}
      />
    );
  }

  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginY={0}>
        <Text color={theme.user} bold>
          you
        </Text>
        <Text wrap="wrap">{message.text}</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      marginY={0}
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
    >
      <Text color={theme.accent} bold>
        m3
      </Text>
      <Text wrap="wrap">
        {message.text}
        {message.streaming ? <Text color={theme.accent}>▌</Text> : null}
      </Text>
    </Box>
  );
}
