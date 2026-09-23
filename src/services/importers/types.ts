import type { Dataset, ValidationIssue } from '@/types';

/**
 * An importer translates one source document shape into the canonical
 * `Dataset`. Adding support for a new export format (Cisco Secure Workload
 * native, Palo Alto, Cisco ASA, Cisco ACI, AWS Security Groups, Azure NSGs,
 * ServiceNow change requests) means writing one of these and registering it —
 * nothing in the analysis engine or the UI needs to change.
 */
export interface DatasetImporter {
  /** Stable machine id, recorded on the dataset metadata. */
  id: string;
  /** Human label shown in the Import screen. */
  label: string;
  description: string;
  /**
   * Confidence that this importer understands the document, 0 to 1.
   * The registry picks the highest scoring importer.
   */
  detect(document: unknown): number;
  /**
   * Translate the document. Importers must never throw on partial or malformed
   * input: collect problems as issues and return whatever could be recovered.
   */
  parse(document: unknown, context: ImportContext): ImporterOutput;
}

export interface ImportContext {
  /** Original file name, when the document came from a file. */
  sourceName?: string;
  /** Injected so imports are deterministic in tests. */
  now?: () => Date;
}

export interface ImporterOutput {
  dataset: Dataset;
  issues: ValidationIssue[];
}
