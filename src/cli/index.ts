#!/usr/bin/env node

import { Command } from 'commander'
import { ConfigLoader, ConfigParseError } from '../config/config-loader.js'
import { handleError } from './helpers.js'
import { registerInstallCommand } from './commands/install.js'
import { registerInitCommand } from './commands/init.js'
import { registerProposeCommand } from './commands/propose.js'
import { registerQuickCommand } from './commands/quick.js'
import { registerPlanCommand } from './commands/plan.js'
import { registerExecuteCommand } from './commands/execute.js'
import { registerVerifyCommand } from './commands/verify.js'
import { registerStatusCommand } from './commands/status.js'
import { registerTasksCommand } from './commands/tasks.js'
import { registerInstructionsCommand } from './commands/instructions.js'
import { registerAnswerCommand } from './commands/answer.js'
import { registerSpecsCommand } from './commands/specs.js'
import { registerIssueCommand } from './commands/issue.js'
import { registerChangesCommand } from './commands/changes.js'
import { registerBacklogCommand } from './commands/backlog.js'
import { registerConfigCommand } from './commands/config.js'
import { registerGateCommand } from './commands/gate.js'
import { registerContextCommand } from './commands/context.js'
import { registerDoctorCommand } from './commands/doctor.js'
import { registerRefreshCommand } from './commands/refresh.js'
import { registerCleanupCommand } from './commands/cleanup.js'
import { registerFinalizeCommand } from './commands/finalize.js'
import { registerShipCommand } from './commands/ship.js'
import { registerAutoCommand } from './commands/auto.js'
import { registerCompleteCommand } from './commands/complete.js'
import { registerNextCommand } from './commands/next.js'
import { registerCompletionCommand } from './commands/completion.js'
import { registerUpdateCommand } from './commands/update.js'
import { registerProgressCommand } from './commands/progress.js'
import { registerImportCommand } from './commands/import.js'
import { registerGapsCommand } from './commands/gaps.js'
import { registerFixGapCommand } from './commands/fix-gap.js'
import { registerFixIssueCommand } from './commands/fix-issue.js'
import { registerCheckConstitutionCommand } from './commands/check-constitution.js'
import { registerValidateStoriesCommand } from './commands/validate-stories.js'
import { registerReconcileCommand } from './commands/reconcile.js'
import { registerDocsCommand } from './commands/docs.js'

const program = new Command()

program
  .name('metta')
  .description('A composable, context-aware, spec-driven development framework')
  .version('0.1.0')
  .option('--json', 'Machine-readable JSON output')
  .option('--verbose', 'Verbose output')
  .option('--debug', 'Debug output')
  .option('--quiet', 'Minimal output')

registerInstallCommand(program)
registerInitCommand(program)
registerProposeCommand(program)
registerQuickCommand(program)
registerPlanCommand(program)
registerExecuteCommand(program)
registerVerifyCommand(program)
registerStatusCommand(program)
registerTasksCommand(program)
registerInstructionsCommand(program)
registerAnswerCommand(program)
registerSpecsCommand(program)
registerIssueCommand(program)
registerChangesCommand(program)
registerBacklogCommand(program)
registerConfigCommand(program)
registerGateCommand(program)
registerContextCommand(program)
registerDoctorCommand(program)
registerRefreshCommand(program)
registerCleanupCommand(program)
registerFinalizeCommand(program)
registerShipCommand(program)
registerAutoCommand(program)
registerCompleteCommand(program)
registerNextCommand(program)
registerCompletionCommand(program)
registerUpdateCommand(program)
registerProgressCommand(program)
registerImportCommand(program)
registerGapsCommand(program)
registerFixGapCommand(program)
registerFixIssueCommand(program)
registerCheckConstitutionCommand(program)
registerValidateStoriesCommand(program)
registerReconcileCommand(program)
registerDocsCommand(program)

// Commands that must still run even when .metta/config.yaml is corrupt.
// These are the repair/bootstrap surfaces that the user needs access to
// in order to recover a broken project config.
const CONFIG_PARSE_EXEMPT_COMMANDS = new Set([
  'install',
  'init',
  'doctor',
  'update',
  'completion',
])

// Preflight hook: fail fast with a ConfigParseError before running any
// command whose action handler may load config itself. Commands that own
// the repair path are exempted so the user can always get back to a good
// state. The ConfigParseError surfaces through handleError, which renders
// the actionable `metta doctor --fix` remedy.
program.hook('preAction', async (_thisCommand, actionCommand) => {
  const name = actionCommand.name()
  if (CONFIG_PARSE_EXEMPT_COMMANDS.has(name)) return
  const json = program.opts().json ?? false
  const loader = new ConfigLoader(process.cwd())
  try {
    await loader.load()
  } catch (err) {
    if (err instanceof ConfigParseError) {
      handleError(err, json)
    }
    // Non-parse errors (e.g. schema validation) belong to the individual
    // command's own error handling — let them through.
  }
})

// Safety net: any ConfigParseError that escapes a command's local try/catch
// still renders the correct actionable remedy instead of a naked stack trace.
program.parseAsync().catch((err: unknown) => {
  if (err instanceof ConfigParseError) {
    handleError(err, program.opts().json ?? false)
  }
  throw err
})
