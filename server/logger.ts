import "server-only";
import pino from "pino";
import { getConfig } from "./config";
import { singleton } from "./singleton";

export const logger = singleton("logger", () =>
  pino({
    level: getConfig().logLevel,
    base: undefined,
    // Never log phone numbers in bulk or credentials; Baileys logs go through the child logger.
    redact: { paths: ["creds", "keys", "*.creds", "*.keys"], remove: true },
  }),
);
