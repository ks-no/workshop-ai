/**
 * Punkt 18.4's published bundle creates a `window` alias on the Node global.
 * Remove only that exact server alias after loading so Next SSR keeps its normal
 * server/browser boundary. Read through Reflect because Next replaces
 * `typeof window` with a build-time constant in server bundles. A real browser
 * Window has a location and must remain available.
 */
import * as Punkt from '@oslokommune/punkt-react';
const runtimeWindow = Reflect.get(globalThis, 'window');
if (runtimeWindow === globalThis && !Reflect.has(runtimeWindow, 'location')) {
  Reflect.deleteProperty(globalThis, 'window');
}
export const { PktButton, PktCheckbox, PktIcon, PktProgressbar, PktRadioButton, PktSelect, PktTabs, PktTag, PktTextarea, PktTextinput } = Punkt;
export type { IPktButton } from '@oslokommune/punkt-react';
