import { Product } from './products';

// vision + weight fusion from chapter 5 of the spec (service B)
// below this YOLOv8 confidence the scan is rejected and the trolley flashes its red LED
export const MIN_CONFIDENCE = 0.60;
// service A's standard weight must match the load cell reading within this many grams
export const WEIGHT_TOLERANCE_G = 10;

export type FusionResult = { accepted: boolean; reason?: string };

export function fuseScan(product: Product, confidence: number, weightDelta: number): FusionResult {
  if (confidence < MIN_CONFIDENCE) return { accepted: false, reason: 'low confidence' };
  // camera says cereal but the scale says brick: reject the addition
  if (Math.abs(weightDelta - product.weight) > WEIGHT_TOLERANCE_G) return { accepted: false, reason: 'weight mismatch' };
  return { accepted: true };
}
