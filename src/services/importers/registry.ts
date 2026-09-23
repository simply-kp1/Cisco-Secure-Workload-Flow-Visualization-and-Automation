import type { DatasetImporter } from './types';
import { genericImporter } from './genericImporter';

/**
 * Registry of available importers.
 *
 * Future formats are added here and nowhere else:
 *   - Cisco Secure Workload native API export
 *   - Cisco ASA / ACI configuration
 *   - Palo Alto security policy export
 *   - AWS Security Groups / Azure NSGs
 *   - ServiceNow change request payloads
 */
const importers: DatasetImporter[] = [genericImporter];

export function listImporters(): DatasetImporter[] {
  return [...importers];
}

export function registerImporter(importer: DatasetImporter): void {
  const index = importers.findIndex((candidate) => candidate.id === importer.id);
  if (index >= 0) importers[index] = importer;
  else importers.push(importer);
}

export function getImporter(id: string): DatasetImporter | undefined {
  return importers.find((importer) => importer.id === id);
}

/** Pick the importer most confident it understands the document. */
export function selectImporter(document: unknown): DatasetImporter | null {
  let best: DatasetImporter | null = null;
  let bestScore = 0;
  for (const importer of importers) {
    const score = importer.detect(document);
    if (score > bestScore) {
      bestScore = score;
      best = importer;
    }
  }
  return bestScore > 0 ? best : null;
}
