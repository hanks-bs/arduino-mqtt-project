/* eslint-disable prefer-destructuring */
/* eslint-disable spaced-comment */
import { NotFoundError } from 'App/errors/CustomError'; // Adjust the import path as necessary
import * as dotenv from 'dotenv';
import path from 'path';

const envPath = path.join(process.cwd(), '.env');

dotenv.config({ path: envPath });

const getEnvVariable = (key: string, defaultValue?: string): string => {
  const value = process.env[key];
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new NotFoundError(`Missing environment variable: ${key}`);
  }
  return value;
};

export const PORT = getEnvVariable('PORT', '3000');

export const MODE = getEnvVariable('NODE_ENV', 'development');

export const SERIAL_PORT = getEnvVariable('SERIAL_PORT', '/dev/ttyUSB0');

export const BAUD_RATE = getEnvVariable('BAUD_RATE', '9600');

export const MQTT_BROKER = getEnvVariable('MQTT_BROKER', 'mqtt://localhost:1883');

export const MQTT_TOPIC = getEnvVariable('MQTT_TOPIC', 'arduino/data');
