import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.logDir, { recursive: true });

const streams = [
  { stream: pino.destination({ dest: path.join(config.logDir, "server.log"), sync: false }) },
  config.isProd
    ? { stream: process.stdout }
    : {
        stream: pino.transport({
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        }),
      },
];

export const logger = pino({ level: config.logLevel }, pino.multistream(streams));
