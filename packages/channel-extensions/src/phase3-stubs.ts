/** Phase 3: channel stubs for remaining OpenClaw channels. */
export const PHASE3_CHANNEL_IDS = [
  "discord",
  "telegram",
  "whatsapp",
  "signal",
  "imessage",
  "googlechat",
  "line",
  "matrix",
  "msteams",
  "mattermost",
  "irc",
  "nostr",
  "nextcloud-talk",
  "synology-chat",
  "twitch",
  "tlon",
  "zalo",
  "zalouser",
  "qqbot",
  "sms",
] as const;

export type Phase3ChannelId = (typeof PHASE3_CHANNEL_IDS)[number];

export function isPhase3Channel(id: string): id is Phase3ChannelId {
  return (PHASE3_CHANNEL_IDS as readonly string[]).includes(id);
}
