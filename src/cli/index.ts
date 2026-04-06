#!/usr/bin/env node

import { Command } from 'commander'
import { registerInitCommand } from './commands/init.js'
import { registerProposeCommand } from './commands/propose.js'
import { registerQuickCommand } from './commands/quick.js'
import { registerPlanCommand } from './commands/plan.js'
import { registerExecuteCommand } from './commands/execute.js'
import { registerVerifyCommand } from './commands/verify.js'
import { registerStatusCommand } from './commands/status.js'
import { registerInstructionsCommand } from './commands/instructions.js'
import { registerAnswerCommand } from './commands/answer.js'
import { registerSpecsCommand } from './commands/specs.js'
import { registerIdeaCommand } from './commands/idea.js'
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

registerInitCommand(program)
registerProposeCommand(program)
registerQuickCommand(program)
registerPlanCommand(program)
registerExecuteCommand(program)
registerVerifyCommand(program)
registerStatusCommand(program)
registerInstructionsCommand(program)
registerAnswerCommand(program)
registerSpecsCommand(program)
registerIdeaCommand(program)
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
registerReconcileCommand(program)
registerDocsCommand(program)

program.parse()
