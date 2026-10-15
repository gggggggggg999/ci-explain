import { ReportSchema, type Report } from '../core/schema.js';

export function renderJson(report: Report): string {
  return JSON.stringify(ReportSchema.parse(report), null, 2) + '\n';
}
