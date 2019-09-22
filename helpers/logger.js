const winston = require('winston');
const {transports, createLogger, format} = require('winston');

// eslint-disable-next-line no-unused-vars
const { Syslog } = require('winston-syslog');
const localhost = require('os').hostname();
// const Config = require('../../config');

const logger = winston.createLogger({
  // defaultMeta: { service: 'user-service' },
  format: format.combine(
    // format.timestamp(),
    format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

const options = {
//   host: Config.papertrail_host,
//   port: Config.papertrail_port,
  app_name: 'real-estate-crawler',
  localhost,
};


logger.add(new winston.transports.Syslog(options));

module.exports = logger;
