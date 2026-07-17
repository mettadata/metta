import { describe, it, expect } from 'vitest'
import { resolveAgentModel } from '../src/context/model-resolver.js'
import type { ModelsConfig } from '../src/schemas/project-config.js'

const PLANNING_ROLES = ['proposer', 'specifier', 'product', 'researcher', 'architect', 'planner']
const SAFETY_NET_ROLES = ['reviewer', 'verifier']
const ALL_TIERS = ['trivial', 'quick', 'standard', 'full']
const PROFILES = ['quality', 'balanced', 'budget'] as const

const CONFIG_VARIANTS: Array<{ label: string; config: ModelsConfig | undefined }> = [
  { label: 'no modelsConfig', config: undefined },
  { label: 'empty modelsConfig', config: {} },
  { label: 'quality profile', config: { profile: 'quality' } },
  { label: 'balanced profile', config: { profile: 'balanced' } },
  { label: 'budget profile', config: { profile: 'budget' } },
  {
    label: 'explicit executor map',
    config: { executor: { trivial: 'haiku', quick: 'sonnet' } },
  },
  {
    label: 'profile plus explicit executor map',
    config: { profile: 'budget', executor: { trivial: 'sonnet', quick: 'haiku' } },
  },
]

describe('resolveAgentModel', () => {
  describe('planning cohort is a hard inherit path', () => {
    for (const role of PLANNING_ROLES) {
      for (const tier of ALL_TIERS) {
        for (const { label, config } of CONFIG_VARIANTS) {
          it(`${role} at ${tier} tier with ${label} resolves inherit`, () => {
            expect(resolveAgentModel(role, tier, config)).toBe('inherit')
          })
        }
      }
    }
  })

  describe('reviewer and verifier are immune to downgrade', () => {
    for (const role of SAFETY_NET_ROLES) {
      for (const tier of ALL_TIERS) {
        for (const { label, config } of CONFIG_VARIANTS) {
          it(`${role} at ${tier} tier with ${label} resolves inherit`, () => {
            expect(resolveAgentModel(role, tier, config)).toBe('inherit')
          })
        }
      }
    }

    it('ignores a hand-built config that bypasses the schema to set cheap reviewer/verifier values', () => {
      const malicious = {
        profile: 'budget',
        reviewer: 'haiku',
        verifier: 'haiku',
      } as unknown as ModelsConfig
      for (const role of SAFETY_NET_ROLES) {
        for (const tier of ALL_TIERS) {
          expect(resolveAgentModel(role, tier, malicious)).toBe('inherit')
        }
      }
    })
  })

  describe('non-executor roles outside the hard paths resolve inherit', () => {
    for (const role of ['discovery', 'constitution-checker', 'some-future-role']) {
      it(`${role} resolves inherit even under a budget profile at quick tier`, () => {
        expect(resolveAgentModel(role, 'quick', { profile: 'budget' })).toBe('inherit')
      })
    }
  })

  describe('executor with no modelsConfig', () => {
    for (const tier of ALL_TIERS) {
      it(`resolves inherit at ${tier} tier`, () => {
        expect(resolveAgentModel('executor', tier, undefined)).toBe('inherit')
      })
    }
  })

  describe('executor outside trivial/quick tier resolves inherit regardless of config', () => {
    for (const tier of ['standard', 'full']) {
      for (const { label, config } of CONFIG_VARIANTS) {
        it(`resolves inherit at ${tier} tier with ${label}`, () => {
          expect(resolveAgentModel('executor', tier, config)).toBe('inherit')
        })
      }
    }
  })

  describe('executor at trivial/quick under named profiles matches PROFILE_MAP', () => {
    const expected: Record<(typeof PROFILES)[number], { trivial: string; quick: string }> = {
      quality: { trivial: 'inherit', quick: 'inherit' },
      balanced: { trivial: 'sonnet', quick: 'sonnet' },
      budget: { trivial: 'haiku', quick: 'sonnet' },
    }
    for (const profile of PROFILES) {
      for (const tier of ['trivial', 'quick'] as const) {
        it(`${profile} profile at ${tier} tier resolves ${expected[profile][tier]}`, () => {
          expect(resolveAgentModel('executor', tier, { profile })).toBe(expected[profile][tier])
        })
      }
    }
  })

  describe('explicit executor map precedence over profile', () => {
    it('explicit executor.quick wins over the profile for quick tier', () => {
      const config: ModelsConfig = { profile: 'quality', executor: { quick: 'haiku' } }
      expect(resolveAgentModel('executor', 'quick', config)).toBe('haiku')
    })

    it('explicit executor.trivial wins over the profile for trivial tier', () => {
      const config: ModelsConfig = { profile: 'budget', executor: { trivial: 'sonnet' } }
      expect(resolveAgentModel('executor', 'trivial', config)).toBe('sonnet')
    })

    it('profile fills the tier key the explicit map leaves unset', () => {
      const config: ModelsConfig = { profile: 'budget', executor: { quick: 'haiku' } }
      expect(resolveAgentModel('executor', 'quick', config)).toBe('haiku')
      expect(resolveAgentModel('executor', 'trivial', config)).toBe('haiku')

      const config2: ModelsConfig = { profile: 'balanced', executor: { trivial: 'haiku' } }
      expect(resolveAgentModel('executor', 'trivial', config2)).toBe('haiku')
      expect(resolveAgentModel('executor', 'quick', config2)).toBe('sonnet')
    })

    it('explicit map with no profile resolves the explicit values and inherit elsewhere', () => {
      const config: ModelsConfig = { executor: { quick: 'sonnet' } }
      expect(resolveAgentModel('executor', 'quick', config)).toBe('sonnet')
      expect(resolveAgentModel('executor', 'trivial', config)).toBe('inherit')
    })

    it('empty modelsConfig resolves inherit at cheap tiers', () => {
      expect(resolveAgentModel('executor', 'trivial', {})).toBe('inherit')
      expect(resolveAgentModel('executor', 'quick', {})).toBe('inherit')
    })
  })

  describe('exhaustive non-inherit boundary', () => {
    it('never returns a non-inherit value for any role except executor', () => {
      const roles = [...PLANNING_ROLES, ...SAFETY_NET_ROLES, 'discovery', 'constitution-checker']
      for (const role of roles) {
        for (const tier of ALL_TIERS) {
          for (const { config } of CONFIG_VARIANTS) {
            expect(resolveAgentModel(role, tier, config)).toBe('inherit')
          }
        }
      }
    })

    it('never returns a non-inherit value for executor outside trivial/quick tier', () => {
      for (const tier of ['standard', 'full', 'custom-tier']) {
        for (const { config } of CONFIG_VARIANTS) {
          expect(resolveAgentModel('executor', tier, config)).toBe('inherit')
        }
      }
    })
  })
})
