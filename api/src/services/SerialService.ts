import { ReadlineParser } from '@serialport/parser-readline';
import { BAUD_RATE, SERIAL_PORT } from 'App/config/config';
import fs from 'node:fs';
import { SerialPort } from 'serialport';

/**
 * Serial port handler with automatic reconnect (exponential backoff).
 *
 * Notes:
 * - Set SERIAL_PORT=disabled to completely skip opening the device (e.g., Windows bridge mode).
 * - On Windows COMx paths, fs.existsSync check is skipped (always false for COM names).
 * - Maintains a lightweight latestData cache for consumption by ArduinoDataService.
 */

class SerialService {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private latestData: string = 'Brak danych';
  private open = false;
  private reconnectAttempts = 0;
  private closing = false;

  constructor() {
    this.init();
  }

  /** Initializes or reinitializes the serial port based on current env config. */
  private init() {
    try {
      // Allow fully disabling the port handler in environments without hardware
      if (/^disabled$/i.test(SERIAL_PORT) || /^none$/i.test(SERIAL_PORT)) {
        if (this.reconnectAttempts === 0) {
          console.log(
            '[Serial] Disabled (SERIAL_PORT=disabled) – skipping initialization',
          );
        }
        return; // brak prób ponownego łączenia
      }
      // On Windows (COMx) fs.existsSync('COM3') returns false despite a present port.
      // Therefore we perform the pre-check only outside Windows.
      const isWindows = process.platform === 'win32';
      if (!isWindows && !fs.existsSync(SERIAL_PORT)) {
        // Device absent – backoff (longer after few attempts) without throwing repeatedly
        const attempt = this.reconnectAttempts + 1;
        const delay = Math.min(60000, 2000 * attempt);
        if (attempt === 1 || attempt % 10 === 0) {
          console.warn(
            `[Serial] Device ${SERIAL_PORT} does not exist (attempt ${attempt}) – retry in ${delay}ms`,
          );
        }
        this.scheduleReconnect(delay);
        return;
      }

      this.port = new SerialPort({
        path: SERIAL_PORT,
        baudRate: Number(BAUD_RATE),
        autoOpen: true,
      });

      this.port.on('open', () => {
        this.open = true;
        this.reconnectAttempts = 0;
  console.log(`[Serial] Opened port ${SERIAL_PORT} @${BAUD_RATE}`);
        if (this.port) {
          this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
          this.parser.on('data', (line: string) => {
            this.latestData = line.trim();
          });
        }
      });

      this.port.on('close', () => {
        this.open = false;
        if (!this.closing) {
          console.warn('[Serial] Port closed – attempting reconnect');
          this.scheduleReconnect();
        }
      });

      this.port.on('error', err => {
        this.open = false;
        if ((err as any).code === 'EACCES') {
          console.error(
            `[Serial] Access error to device ${SERIAL_PORT} (EACCES). Try:\n` +
              ' - granting permissions on host (chmod/udev)\n' +
              ' - running container as root (user: root)\n' +
              ' - adding group_add: ["dialout"] in docker-compose\n',
          );
        } else if ((err as any).code === 'ENOENT') {
          console.error(`[Serial] Device disappeared: ${SERIAL_PORT}`);
        } else {
          console.error('[Serial] Błąd:', err.message);
        }
        this.scheduleReconnect();
      });
    } catch (e: any) {
      console.error('[Serial] Exception during initialization:', e?.message || e);
      this.scheduleReconnect();
    }
  }

  /** Schedules a reconnect attempt with exponential backoff. */
  private scheduleReconnect(customDelay?: number) {
    if (this.closing) return;
    const attempt = ++this.reconnectAttempts;
    const delay =
      customDelay !== undefined
        ? customDelay
        : Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)); // 1s,2s,4s,8s,16s,30s cap
    if (attempt <= 6 || attempt % 10 === 0) {
      console.log(`[Serial] Reconnect attempt ${attempt} in ${delay}ms`);
    }
    setTimeout(() => this.init(), delay).unref();
  }

  /** Returns the last read data from the serial port (trimmed line). */
  public getLatestData(): string {
    return this.latestData;
  }

  public isOpen(): boolean {
    return this.open;
  }

  /** Closes the port gracefully (used on server shutdown). */
  public close(): Promise<void> {
    this.closing = true;
    return new Promise((resolve, reject) => {
      if (!this.port) return resolve();
      this.port.close(err => {
        if (err) return reject(err);
  console.log('[Serial] Port closed.');
        resolve();
      });
    });
  }
}

export default new SerialService();
