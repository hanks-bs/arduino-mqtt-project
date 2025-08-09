/* eslint-disable prefer-destructuring */
/* eslint-disable spaced-comment */
import { NotFoundError } from 'App/errors/CustomError'; // Adjust the import path as necessary
import * as dotenv from 'dotenv';
import path from 'path';

const envPath = path.join(process.cwd(), '.env');

dotenv.config({ path: envPath });

const getEnvVariable = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new NotFoundError(`Missing environment variable: ${key}`);
  }
  return value;
};

export const PORT = getEnvVariable('PORT');

export const MODE = getEnvVariable('NODE_ENV');

export const SERIAL_PORT = getEnvVariable('SERIAL_PORT');

export const BAUD_RATE = getEnvVariable('BAUD_RATE');

export const MQTT_BROKER = getEnvVariable('MQTT_BROKER');

export const MQTT_TOPIC = getEnvVariable('MQTT_TOPIC');
