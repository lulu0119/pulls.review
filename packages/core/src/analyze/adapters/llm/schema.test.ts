import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { GroupedResultSchema } from '../../../types/analyze'
import { AnalysisSchema } from './schema'

describe('aI group explanations', () => {
  const group = { key: 'core', label: 'Core', category: 'core', filePaths: ['a.ts'] }
  it.each([undefined, '', '  '])('accepts an AI group without an explanation (%s)', (summary) => {
    expect(v.safeParse(AnalysisSchema, { overallSummary: 'Updates parsing.', groups: [{ ...group, summary }] }).success).toBe(true)
  })
  it('accepts child groups without explanations too', () => {
    expect(v.safeParse(AnalysisSchema, { overallSummary: 'Updates parsing.', groups: [{ ...group, children: [group] }] }).success).toBe(true)
  })
  it('keeps older cached and rule-based groups readable without summaries', () => {
    expect(v.safeParse(GroupedResultSchema, { source: 'llm', generatedAt: '2026-11-05', schemaVersion: 1, groups: [group] }).success).toBe(true)
  })
})
