import { Box, Text } from "ink";
import { theme } from "../theme.js";

export type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
};

export function MessageList(props: { messages: ChatLine[]; maxLines?: number }) {
  const max = props.maxLines ?? 14;
  const slice = props.messages.slice(-max);

  return (
    <Box flexDirection="column" marginBottom={1} minHeight={Math.min(slice.length, 8)}>
      {slice.length === 0 ? (
        <Text dimColor>Send a message or type / for commands</Text>
      ) : (
        slice.map((msg) => <MessageRow key={msg.id} message={msg} />)
      )}
    </Box>
  );
}

function MessageRow({ message }: { message: ChatLine }) {
  if (message.role === "system") {
    return (
      <Box marginY={0}>
        <Text color={theme.system} dimColor>
          ◆ {message.text}
        </Text>
      </Box>
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
