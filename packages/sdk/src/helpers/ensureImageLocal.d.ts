import { ImageSize } from './constants';

export type EnsureImageLocalParams = {
  transactionId?: string;
  fileName?: string;
  widths?: number[];
};

export type EnsureImageLocalResult = {
  status: 'ready' | 'unsupported' | 'failed' | 'missing-id';
  filePath?: string;
  createdWidths?: number[];
};

export declare const normalizeArweaveTxIdForEnsure: (raw: string | null | undefined) => string | undefined;
export declare const closestImageSize: (width: number) => ImageSize;
export declare const ensureImageLocal: (params: EnsureImageLocalParams) => Promise<EnsureImageLocalResult>;
export declare const resetEnsureImageLocalInFlightForTests: () => void;
