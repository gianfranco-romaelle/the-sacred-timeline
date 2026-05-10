export type AssertionLayer = "canonical" | "editorial" | "ai_hypothesis";

export interface ProvenanceRecord {
  assertionLayer: AssertionLayer;
  assertedBy?: string;
  assertedAt?: string;
  evidenceFragment?: string;
  confidence?: number;
}
