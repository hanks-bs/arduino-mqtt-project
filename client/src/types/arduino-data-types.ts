export interface Measurement {
	potValue: number;
	voltagePot: number;
	lm35Value: number;
	voltageLM35: number;
	temperature: number;
	readingTime: number;
	uptimeSec: number;
	readingCount: number;
	timestamp: string;
}
export interface ArduinoDataPayload {
	lastMeasurement: Measurement;
	history: Measurement[];
}
