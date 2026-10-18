import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import '../i18n';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Mantine reads these browser APIs, which jsdom does not provide.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;

// Mantine's Combobox (Select) scrolls the selected option into view.
Element.prototype.scrollIntoView = () => {};
