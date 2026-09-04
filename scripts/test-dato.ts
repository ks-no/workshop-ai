#!/usr/bin/env node

import { getNorwegianCalendarYear } from "../apps/shared/dato.ts";

const beforeNorwegianNewYear = Date.parse("2025-12-31T22:59:59.999Z");
const atNorwegianNewYear = Date.parse("2025-12-31T23:00:00.000Z");

if (
  getNorwegianCalendarYear(beforeNorwegianNewYear) !== 2025
  || getNorwegianCalendarYear(atNorwegianNewYear) !== 2026
) {
  throw new Error("Norsk kalenderår skifter ikke ved norsk midnatt.");
}

console.log("Datotest: norsk kalenderår via UTC er riktig.");
