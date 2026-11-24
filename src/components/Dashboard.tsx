"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Loader2,
  PlayCircle,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import type { Concept, GenerationResult } from '@/lib/constants';

interface Approval {
  status: 'approved' | 'rejected';
  note: string;
}

type Approvals = Record<number, Approval>;

const APPROVALS_STORAGE_KEY = 'science-diagram-maker:approvals';

interface DashboardProps {
  concepts: Concept[];
  initialResults: GenerationResult[];
}

export function Dashboard({ concepts, initialResults }: DashboardProps) {
  const [results, setResults] = useState<GenerationResult[]>(initialResults);
  const [approvals, setApprovals] = useState<Approvals>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busyConceptId, setBusyConceptId] = useState<number | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Restore the reviewer's decisions from localStorage after the page loads.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(APPROVALS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as {
          approvals?: Approvals;
          notes?: Record<number, string>;
        };
        setApprovals(parsed.approvals ?? {});
        setNotes(parsed.notes ?? {});
      }
    } catch {
      // A corrupt or blocked localStorage should never break the page.
    }
    setHydrated(true);
  }, []);

  const persist = useCallback((nextApprovals: Approvals, nextNotes: Record<number, string>) => {
    try {
      window.localStorage.setItem(
        APPROVALS_STORAGE_KEY,
        JSON.stringify({ approvals: nextApprovals, notes: nextNotes })
      );
    } catch {
      // Ignore quota / privacy-mode errors.
    }
  }, []);

  const decide = (conceptId: number, status: 'approved' | 'rejected') => {
    const note = notes[conceptId] ?? '';
    const nextApprovals = { ...approvals, [conceptId]: { status, note } };
    setApprovals(nextApprovals);
    persist(nextApprovals, notes);
  };

  const updateNote = (conceptId: number, note: string) => {
    const nextNotes = { ...notes, [conceptId]: note };
    setNotes(nextNotes);
    persist(approvals, nextNotes);
  };

  const generateOne = async (conceptId: number) => {
    setBusyConceptId(conceptId);
    setError(null);
    try {
      const response = await fetch('/api/generate-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conceptId }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? `Generation failed with status ${response.status}.`);
      }

      setResults((previous) => [
        ...previous.filter((result) => result.conceptId !== conceptId),
        payload as GenerationResult,
      ]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Something went wrong while generating the diagram.'
      );
    } finally {
      setBusyConceptId(null);
    }
  };

  const generateAll = async () => {
    setIsGeneratingAll(true);
    setError(null);
    try {
      const response = await fetch('/api/generate-all', { method: 'POST' });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error ?? `Generation failed with status ${response.status}.`);
      }

      setResults(payload as GenerationResult[]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Something went wrong while generating the diagrams.'
      );
    } finally {
      setIsGeneratingAll(false);
    }
  };

  // Always show exactly one row per concept, even if a concept has no result yet.
  const rows = useMemo(
    () =>
      concepts.map((concept) => ({
        concept,
        result: results.find((result) => result.conceptId === concept.id),
      })),
    [concepts, results]
  );

  const totalCost = results.reduce((sum, result) => sum + result.cost, 0);
  const totalRetries = results.reduce((sum, result) => sum + result.retries, 0);
  const approvedCount = Object.values(approvals).filter((a) => a.status === 'approved').length;
  const rejectedCount = Object.values(approvals).filter((a) => a.status === 'rejected').length;

  return (
    <main className="min-h-screen bg-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">
              Udhi Technologies &middot; Home Assignment
            </p>
            <h1 className="mt-1 text-4xl font-extrabold tracking-tight text-slate-900">
              Science Diagram Maker
            </h1>
            <p className="mt-2 max-w-2xl text-slate-600">
              AI-generated animated SVG diagrams for UK GCSE science, validated in code and
              queued for human review.
            </p>
          </div>

          <button
            type="button"
            onClick={generateAll}
            disabled={isGeneratingAll || busyConceptId !== null}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGeneratingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {isGeneratingAll ? 'Generating…' : 'Generate all 5 diagrams'}
          </button>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-lg border-l-4 border-red-500 bg-red-50 p-4 text-red-800"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Generation failed</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Diagrams" value={String(results.length)} />
          <SummaryCard label="Approved" value={String(hydrated ? approvedCount : 0)} />
          <SummaryCard label="Rejected" value={String(hydrated ? rejectedCount : 0)} />
          <SummaryCard label="Total cost" value={`$${totalCost.toFixed(4)}`} />
        </section>

        <div className="overflow-hidden rounded-xl bg-white shadow ring-1 ring-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Concept</Th>
                  <Th>Diagram</Th>
                  <Th>Validation checks</Th>
                  <Th>Cost / retries</Th>
                  <Th>Review</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map(({ concept, result }) => {
                  const approval = approvals[concept.id];
                  const isBusy = busyConceptId === concept.id;

                  return (
                    <tr key={concept.id} className="align-top">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-900">{concept.subject}</p>
                        <p className="mt-1 max-w-xs text-xs text-slate-500">{concept.text}</p>
                        <button
                          type="button"
                          onClick={() => generateOne(concept.id)}
                          disabled={isBusy || isGeneratingAll}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-400 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <PlayCircle className="h-3.5 w-3.5" />
                          )}
                          {isBusy ? 'Generating…' : 'Generate'}
                        </button>
                      </td>

                      <td className="px-5 py-4">
                        {result ? (
                          <div
                            className="diagram-preview h-36 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white"
                            // Safe: the validator rejects <script>, on* handlers and
                            // javascript: URLs before an SVG is accepted.
                            dangerouslySetInnerHTML={{ __html: result.svg }}
                          />
                        ) : (
                          <div className="flex h-36 w-52 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
                            No diagram yet
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        {result ? (
                          <ul className="space-y-1 text-xs">
                            <CheckRow
                              label="Parsable"
                              passed={result.validation.checks.isParsable}
                            />
                            <CheckRow
                              label="Within viewBox"
                              passed={result.validation.checks.withinViewBox}
                            />
                            <CheckRow
                              label="Title + 3 labels"
                              passed={result.validation.checks.hasTitleAndLabels}
                            />
                            <CheckRow
                              label="Has animation"
                              passed={result.validation.checks.hasAnimation}
                            />
                            <CheckRow
                              label="No scripts"
                              passed={result.validation.checks.noScripts}
                            />
                          </ul>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-xs text-slate-600">
                        {result ? (
                          <>
                            <p className="font-semibold text-slate-900">
                              ${result.cost.toFixed(5)}
                            </p>
                            <p className="mt-1">Retries: {result.retries}</p>
                            <p className="mt-1">Model: {result.modelName}</p>
                            <p className="mt-1">
                              Tokens: {result.inputTokens} in / {result.outputTokens} out
                            </p>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => decide(concept.id, 'approved')}
                            aria-label={`Approve ${concept.subject}`}
                            className={`rounded-md p-2 transition ${
                              approval?.status === 'approved'
                                ? 'bg-green-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-green-100 hover:text-green-700'
                            }`}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => decide(concept.id, 'rejected')}
                            aria-label={`Reject ${concept.subject}`}
                            className={`rounded-md p-2 transition ${
                              approval?.status === 'rejected'
                                ? 'bg-red-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-700'
                            }`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <textarea
                          value={notes[concept.id] ?? ''}
                          onChange={(event) => updateNote(concept.id, event.target.value)}
                          placeholder="Reviewer note…"
                          rows={2}
                          className="mt-2 w-52 rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                        />
                      </td>

                      <td className="px-5 py-4">
                        {approval ? (
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              approval.status === 'approved'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {approval.status.toUpperCase()}
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                            PENDING
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Total retries across all diagrams: {totalRetries}. Approve / Reject decisions and
          notes are stored in this browser&rsquo;s localStorage, so they survive a page refresh.
        </p>
      </div>
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </th>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function CheckRow({ label, passed }: { label: string; passed: boolean }) {
  return (
    <li className={`flex items-center gap-1.5 ${passed ? 'text-slate-700' : 'font-semibold text-red-600'}`}>
      {passed ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-red-600" />
      )}
      {label}
    </li>
  );
}
