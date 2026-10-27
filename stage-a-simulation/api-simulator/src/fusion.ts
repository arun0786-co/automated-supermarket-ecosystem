import { Product } from './products';

// vision + weight fusion from chapter 5 of the spec (service B)
// below this YOLOv8 confidence the scan is rejected and the trolley flashes its red LED
export const MIN_CONFIDENCE = 0.60;

export type FusionResult = { accepted: boolean; reason?: string };

export function fuseScan(_product: Product, confidence: number, _weightDelta: number): FusionResult {
  if (confidence < MIN_CONFIDENCE) return { accepted: false, reason: 'low confidence' };
  return { accepted: true };
}
