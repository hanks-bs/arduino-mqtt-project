// Globalny setup dla testów: redukcja hałaśliwych logów i bezpieczne ENV

// 1) Wyłączamy port szeregowy w testach, by uniknąć prób otwierania COM/tty
process.env.SERIAL_PORT = process.env.SERIAL_PORT || 'disabled';

// 2) Wyłącz emisje WS na żywo, by ograniczyć wpływ na pomiary i logi
process.env.LIVE_REALTIME_ENABLED = process.env.LIVE_REALTIME_ENABLED || '0';

// 3) Szybszy tick monitora, by skrócić czas oczekiwania na próbki w testach
process.env.MONITOR_TICK_MS = process.env.MONITOR_TICK_MS || '150';

// 4) Ogranicz hałaśliwe logi w konsoli podczas testów
const mute = process.env.JEST_SILENT !== '0';
if (mute) {
  const noop = () => {};
  jest.spyOn(console, 'error').mockImplementation(noop);
  jest.spyOn(console, 'warn').mockImplementation(noop);
  // Opcjonalnie można również ograniczyć console.log (zostawiamy aby widzieć kluczowe komunikaty)
}

// 5) Globalny mock mqtt, by publishData nie otwierał realnych połączeń
jest.mock('mqtt', () => {
  const handlers: Record<string, Function> = {};
  return {
    connect: () => ({
      on: (event: string, cb: Function) => {
        handlers[event] = cb;
        // natychmiastowo wywołaj 'connect' po subskrypcji, aby zasymulować gotowość
        if (event === 'connect') setTimeout(() => cb(), 0);
      },
      subscribe: (_topic: string, _opts: any, cb: Function) => {
        // subskrypcja zawsze „udana”
        setTimeout(() => cb(null), 0);
      },
      publish: (_topic: string, _data: any, _opts: any, cb: Function) => {
        setTimeout(() => cb(null), 0);
      },
      end: () => {},
    }),
  };
});
