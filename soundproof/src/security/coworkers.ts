import { User } from "discord.js";

const configuredNames = (process.env.COWORKER_DISCORD_USERNAMES ?? "")
  .split(",")
  .map(name => name.trim().toLowerCase())
  .filter(Boolean);

const configuredIds = (process.env.COWORKER_DISCORD_USER_IDS ?? "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

export function isCoworker(user: User): boolean {
  if (configuredIds.includes(user.id)) {
    return true;
  }

  const names = [user.username, user.globalName]
    .filter((name): name is string => Boolean(name))
    .map(name => name.toLowerCase());

  return names.some(name => configuredNames.includes(name));
}