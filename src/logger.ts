import winston from 'winston';
const { combine, timestamp, printf, colorize } = winston.format;

const customFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});

export default winston.createLogger({
  format: combine(
    colorize(),
    timestamp(),
    customFormat
    ),
    transports: [
      new winston.transports.Console()
    ] 
  });