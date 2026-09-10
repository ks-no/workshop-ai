'use client';

import { PktButton, PktIcon, type IPktButton } from './punkt-react';
import type { ComponentProps } from 'react';

declare global { interface Window { pktIconPath?: string } }

if (typeof window !== 'undefined') {
  window.pktIconPath = '/punkt/icons/';
  window.pktAnimationPath = '/punkt/animations/';
}

/** Explicit asset paths also avoid Punkt's browser-only default during server rendering. */
export function AssistantButton(props: IPktButton) {
  return <PktButton loadingAnimationPath="/punkt/animations/" iconPath="/punkt/icons/" secondIconPath="/punkt/icons/" {...props} />;
}
export function AssistantIcon(props: ComponentProps<typeof PktIcon>) {
  return <PktIcon path="/punkt/icons/" {...props} />;
}
