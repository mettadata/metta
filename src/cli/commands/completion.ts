import { Command } from 'commander'

export function registerCompletionCommand(program: Command): void {
  program
    .command('completion')
    .description('Generate shell completion script')
    .argument('<shell>', 'Shell type: bash, zsh, fish')
    .action(async (shell) => {
      const name = 'metta'

      switch (shell) {
        case 'bash':
          console.log(`# metta bash completion
# Add to ~/.bashrc: eval "$(metta completion bash)"
_metta_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local cmds="install init propose quick auto plan execute verify finalize ship status instructions complete next answer specs idea ideas issue issues changes backlog config gate context doctor refresh cleanup completion update"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$cmds" -- "$cur") )
  fi
}
complete -F _metta_completions ${name}`)
          break

        case 'zsh':
          console.log(`# metta zsh completion
# Add to ~/.zshrc: eval "$(metta completion zsh)"
_metta() {
  local -a commands=(
    'install:Install Metta into a project'
    'propose:Start a new change (standard workflow)'
    'quick:Quick mode — small changes'
    'auto:Full lifecycle loop'
    'plan:Build planning artifacts'
    'execute:Run implementation'
    'verify:Verify against spec'
    'finalize:Archive and merge specs'
    'ship:Merge branch to main'
    'status:Show change status'
    'instructions:Get AI instructions'
    'complete:Mark artifact complete'
    'next:Show next step'
    'specs:Manage specifications'
    'idea:Capture a feature idea'
    'issue:Log an issue'
    'changes:Manage active changes'
    'backlog:Manage backlog'
    'config:Manage configuration'
    'gate:Manage gates'
    'context:Context budget management'
    'doctor:Diagnose issues'
    'refresh:Regenerate derived files'
    'cleanup:Clean orphaned resources'
    'completion:Generate shell completion'
    'update:Update Metta framework'
  )
  _describe 'command' commands
}
compdef _metta ${name}`)
          break

        case 'fish':
          console.log(`# metta fish completion
# Save to ~/.config/fish/completions/metta.fish
complete -c ${name} -n "__fish_use_subcommand" -a install -d "Install Metta into a project"
complete -c ${name} -n "__fish_use_subcommand" -a propose -d "Start a new change"
complete -c ${name} -n "__fish_use_subcommand" -a quick -d "Quick mode"
complete -c ${name} -n "__fish_use_subcommand" -a auto -d "Full lifecycle loop"
complete -c ${name} -n "__fish_use_subcommand" -a plan -d "Build planning artifacts"
complete -c ${name} -n "__fish_use_subcommand" -a execute -d "Run implementation"
complete -c ${name} -n "__fish_use_subcommand" -a verify -d "Verify against spec"
complete -c ${name} -n "__fish_use_subcommand" -a finalize -d "Archive and merge specs"
complete -c ${name} -n "__fish_use_subcommand" -a ship -d "Merge branch to main"
complete -c ${name} -n "__fish_use_subcommand" -a status -d "Show change status"
complete -c ${name} -n "__fish_use_subcommand" -a instructions -d "Get AI instructions"
complete -c ${name} -n "__fish_use_subcommand" -a complete -d "Mark artifact complete"
complete -c ${name} -n "__fish_use_subcommand" -a next -d "Show next step"
complete -c ${name} -n "__fish_use_subcommand" -a specs -d "Manage specifications"
complete -c ${name} -n "__fish_use_subcommand" -a idea -d "Capture a feature idea"
complete -c ${name} -n "__fish_use_subcommand" -a issue -d "Log an issue"
complete -c ${name} -n "__fish_use_subcommand" -a changes -d "Manage active changes"
complete -c ${name} -n "__fish_use_subcommand" -a backlog -d "Manage backlog"
complete -c ${name} -n "__fish_use_subcommand" -a config -d "Manage configuration"
complete -c ${name} -n "__fish_use_subcommand" -a gate -d "Manage gates"
complete -c ${name} -n "__fish_use_subcommand" -a context -d "Context budget"
complete -c ${name} -n "__fish_use_subcommand" -a doctor -d "Diagnose issues"
complete -c ${name} -n "__fish_use_subcommand" -a refresh -d "Regenerate files"
complete -c ${name} -n "__fish_use_subcommand" -a cleanup -d "Clean resources"
complete -c ${name} -n "__fish_use_subcommand" -a completion -d "Shell completion"
complete -c ${name} -n "__fish_use_subcommand" -a update -d "Update framework"`)
          break

        default:
          console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`)
          process.exit(4)
      }
    })
}
