#include <Arduino.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>
#include <Wire.h>
#include <util/delay.h>

// LCD address might vary (0x27 or 0x3F are common).
// The parameters (20,4) indicate a 20-column x 4-row display.
LiquidCrystal_I2C lcd(0x27, 20, 4);

// Global variables
const int potentiometerPin = A0;  // Pin assignment for the potentiometer
const int lm35Pin = A1;           // Pin assignment for the LM35 sensor

unsigned long readingCount = 0;  // Counts how many times we read the sensors

/**
 * Reads an analog value from the specified pin in a "stable" manner.
 * - First read is discarded.
 * - After a short delay, a second read is performed and returned.
 */
int readStableAnalog(int pin) {
    // Discard the first reading
    analogRead(pin);
    // Wait a moment
    _delay_ms(5);
    // Return the second reading
    return analogRead(pin);
}

void setup() {
    // Initialize serial communication for debugging/JSON output
    Serial.begin(9600);

    // Initialize the LCD
    lcd.init();
    lcd.backlight();  // Turn on the LCD backlight
}

void loop() {
    // Increment the reading count each time we perform a measurement
    readingCount++;

    // Read the potentiometer value
    int potValue = readStableAnalog(potentiometerPin);
    float voltagePot = potValue * (5.0 / 1023.0);

    // Calculate the percentage of potentiometer rotation (0% to 100%)
    float potPercentage = (potValue / 1023.0) * 100.0;

    // Read the LM35 sensor value
    int lm35Value = readStableAnalog(lm35Pin);
    float voltageLM35 = lm35Value * (5.0 / 1023.0);
    // LM35 provides 10 mV/°C (0.01 V/°C)
    float temperature = voltageLM35 / 0.01;

    // Capture the current time in milliseconds since Arduino start
    unsigned long currentMillis = millis();
    unsigned long uptimeSec = currentMillis / 1000;  // Uptime in seconds

    // Display the results on the LCD
    lcd.clear();

    // First line: Potentiometer percentage
    lcd.setCursor(0, 0);
    lcd.print("Pot: ");
    lcd.print(potPercentage, 1);  // 1 decimal place
    lcd.print("%");

    // Second line: Temperature in Celsius
    lcd.setCursor(0, 1);
    lcd.print("Temp: ");
    lcd.print(temperature, 1);  // 1 decimal place
    lcd.print(" C");

    // Third line: Number of readings (readingCount)
    lcd.setCursor(0, 2);
    lcd.print("Count: ");
    lcd.print(readingCount);

    // Fourth line: Uptime in seconds
    lcd.setCursor(0, 3);
    lcd.print("Uptime: ");
    lcd.print(uptimeSec);
    lcd.print("s");

    // Create a JSON document to hold the data
    JsonDocument doc;

    doc["potValue"] = potValue;
    doc["voltagePot"] = voltagePot;
    doc["lm35Value"] = lm35Value;
    doc["voltageLM35"] = voltageLM35;
    doc["temperature"] = temperature;

    // Additional data
    doc["readingTime"] = currentMillis;  // time of reading in ms
    doc["uptimeSec"] = uptimeSec;        // uptime in seconds
    doc["readingCount"] = readingCount;  // how many readings so far

    // Serialize the JSON object into a buffer
    char buffer[256];
    size_t n = serializeJson(doc, buffer);

    // Send the JSON data over Serial
    Serial.write(buffer, n);
    Serial.println();

    // Delay before the next reading
    _delay_ms(500);
}
