import { workflowRunsTotal, workflowDurationSeconds } from '../metrics.js';

export interface RecordWorkflowCompleteInput {
    workflow: string;
    status: 'success' | 'failure';
    durationMs: number;
}

export async function recordWorkflowComplete(input: RecordWorkflowCompleteInput): Promise<void> {
    workflowRunsTotal.inc({ workflow: input.workflow, status: input.status });
    workflowDurationSeconds.observe({ workflow: input.workflow }, input.durationMs / 1000);
}
