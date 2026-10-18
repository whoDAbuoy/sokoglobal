// Minimal typings for the part of @paystack/inline-js (v2) that SokoGlobal uses.
declare module '@paystack/inline-js' {
  interface PaystackCallbacks {
    onSuccess?: (transaction: { reference: string; status?: string; trans?: string; message?: string }) => void;
    onCancel?: () => void;
    onLoad?: (response: unknown) => void;
    onError?: (error: unknown) => void;
  }
  export default class PaystackPop {
    /** Open the secure card form for a transaction initialized server-side (access_code). */
    resumeTransaction(accessCode: string, callbacks?: PaystackCallbacks): unknown;
  }
}
