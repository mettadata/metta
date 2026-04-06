import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

export function registerGapsCommand(program: Command): void {
  const gaps = program
    .command('gaps')
    .description('Manage reconciliation gaps')

  gaps
    .command('list')
    .description('List all gaps with status')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()
      const list = await ctx.gapsStore.list()
      if (json) { outputJson({ gaps: list }) } else {
        if (list.length === 0) { console.log('No gaps found.') } else {
          for (const g of list) { console.log(`  [${g.status}] ${g.slug.padEnd(30)} ${g.title}`) }
        }
      }
    })

  gaps
    .command('show')
    .argument('<slug>', 'Gap slug')
    .description('Show a specific gap')
    .action(async (slug) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const gap = await ctx.gapsStore.show(slug)
        if (json) { outputJson(gap) } else {
          console.log(`# Gap: ${gap.title}`)
          console.log(`Status: ${gap.status}`)
          if (gap.source) console.log(`Source: ${gap.source}`)
          if (gap.claim) console.log(`Claim: ${gap.claim}`)
          if (gap.evidence) console.log(`Evidence: ${gap.evidence}`)
          if (gap.impact) console.log(`Impact: ${gap.impact}`)
          if (gap.relatedSpec) console.log(`Related Spec: ${gap.relatedSpec}`)
          console.log('')
          console.log(gap.action ?? `Promote to spec: metta propose --from-gap ${slug}`)
        }
      } catch {
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: `Gap '${slug}' not found` } }) } else { console.error(`Gap '${slug}' not found`) }
        process.exit(4)
      }
    })
}
