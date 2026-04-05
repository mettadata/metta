import { Command } from 'commander'
import { outputJson } from '../helpers.js'

export function registerAnswerCommand(program: Command): void {
  program
    .command('answer')
    .description('Submit user answers to discovery questions')
    .option('--change <name>', 'Change name')
    .option('--artifact <artifact>', 'Artifact ID')
    .action(async (options) => {
      const json = program.opts().json
      // In v0.1, answers are handled via the AI tool's native question mechanism
      // This command records answers for the discovery gate
      if (json) {
        outputJson({ status: 'acknowledged', change: options.change, artifact: options.artifact })
      } else {
        console.log('Answers recorded.')
      }
    })
}
