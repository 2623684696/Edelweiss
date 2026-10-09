import { Format, initLogger, LogLevel, useGlobalLogger } from '@guiiai/logg';

const resolveLogLevel = (nodeEnv: string | undefined): LogLevel =>
  nodeEnv === 'production' ? LogLevel.Log : LogLevel.Debug;

const resolveLogFormat = (logFormat: string | undefined): Format =>
  logFormat?.toLowerCase() === 'json' ? Format.JSON : Format.Pretty;

export const setupLogger = () => {
  initLogger(
    resolveLogLevel(process.env.NODE_ENV),
    resolveLogFormat(process.env.EDELWEISS_LOG_FORMAT),
  );
};

export const useLogger = (context: string) => useGlobalLogger(context);
