/** Lets any button open the floating support widget on a given order's chat. */
export const OPEN_SUPPORT_EVENT = 'sokoglobal:open-support';

export interface OpenSupportDetail { orderId?: string; /** Which tab to open on (default: chat). */ tab?: 'help' | 'chat' }

export function openSupport(detail: OpenSupportDetail = {}) {
  window.dispatchEvent(new CustomEvent<OpenSupportDetail>(OPEN_SUPPORT_EVENT, { detail }));
}
