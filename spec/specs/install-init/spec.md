# split-metta-install-metta-init

## Requirement: init-command-drives-discovery

The  command MUST produce the discovery payload consumed by AI agents to run project discovery. It MUST detect brownfield versus greenfield mode by scanning for language/framework marker files and non-empty source directories. It MUST emit the  object (agent persona, mode, detected stack, questions, output paths, constitution and context templates) to stdout when  is set. It MUST require a prior  and MUST NOT scaffold any files, install any commands, or create commits.

### Scenario: init after install in a brownfield project
- GIVEN a project where  has been run and  plus a non-empty  exist
- WHEN the user runs
- THEN the command emits JSON containing a  object with ,  including Rust,  including , the brownfield question set, and absolute  for constitution, context_file, and config

### Scenario: init on a greenfield project
- GIVEN a project where  has been run and no stack marker files or source directories are present
- WHEN the user runs
- THEN the command emits  with the greenfield question set and empty  and

### Scenario: init before install is blocked
- GIVEN a project with no  directory
- WHEN the user runs
- THEN the command exits with code 3, emits an error JSON whose message instructs the user to run  first, and writes nothing to the filesystem

### Scenario: init does not mutate the repository
- GIVEN an installed project with a clean working tree
- WHEN the user runs
- THEN after the command the working tree remains clean, no new commits are created,  and  are byte-identical to their pre-run state


## Requirement: init-skill-invokes-init-command

The  Claude Code skill MUST invoke  (not ) as its first step, parse the  object from the response, and spawn a  agent with the parsed fields. The skill template in  MUST match the skill installed into target projects under  via the command installer.

### Scenario: skill template references init command
- GIVEN the skill template at
- WHEN a reader inspects the bash command on the first numbered step
- THEN the command is , not

### Scenario: skill propagates to installed projects
- GIVEN a project where  has been run
- WHEN the installer copies  from the template
- THEN the installed copy also invokes


## Requirement: install-command-scaffolds-only

The  command MUST scaffold Metta files into the project and MUST NOT emit discovery instructions or brownfield/greenfield classification. It MUST create , , ,  directories; write default , , and  if absent; install  slash commands, skills, and agents; regenerate  via the refresh pipeline; and commit the result as  when there are staged changes. The  output MUST NOT include a  field and MUST NOT include a  field — project classification is the responsibility of . The command MUST NOT perform brownfield detection.

### Scenario: fresh install in a git repo
- GIVEN a git-initialized project with no  directory
- WHEN the user runs
- THEN the command creates , , , , , installs  assets, regenerates , commits as , and emits JSON with  and no  or  keys

### Scenario: install on a project that already has .metta
- GIVEN a project where  has been run previously
- WHEN the user runs  again
- THEN the command exits successfully without overwriting  or , does not produce a new commit when nothing changed, and reports  with

### Scenario: install without a git repository
- GIVEN a directory with no
- WHEN the user runs  without
- THEN the command exits with code 3 and emits  without scaffolding any files

### Scenario: human-readable install output points at init
- GIVEN a fresh project
- WHEN the user runs  without
- THEN the final line of stdout directs them to run  next


## Requirement: init-command-drives-discovery

The  command MUST produce the discovery payload consumed by AI agents to run project discovery. It MUST detect brownfield versus greenfield mode by scanning for language/framework marker files and non-empty source directories. It MUST emit the  object (agent persona, mode, detected stack, questions, output paths, constitution and context templates) to stdout when  is set. It MUST require a prior  and MUST NOT scaffold any files, install any commands, or create commits.

### Scenario: init after install in a brownfield project
- GIVEN a project where  has been run and  plus a non-empty  exist
- WHEN the user runs
- THEN the command emits JSON containing a  object with ,  including Rust,  including , the brownfield question set, and absolute  for constitution, context_file, and config

### Scenario: init on a greenfield project
- GIVEN a project where  has been run and no stack marker files or source directories are present
- WHEN the user runs
- THEN the command emits  with the greenfield question set and empty  and

### Scenario: init before install is blocked
- GIVEN a project with no  directory
- WHEN the user runs
- THEN the command exits with code 3, emits an error JSON whose message instructs the user to run  first, and writes nothing to the filesystem

### Scenario: init does not mutate the repository
- GIVEN an installed project with a clean working tree
- WHEN the user runs
- THEN after the command the working tree remains clean, no new commits are created,  and  are byte-identical to their pre-run state


## Requirement: init-skill-invokes-init-command

The  Claude Code skill MUST invoke  (not ) as its first step, parse the  object from the response, and spawn a  agent with the parsed fields. The skill template in  MUST match the skill installed into target projects under  via the command installer.

### Scenario: skill template references init command
- GIVEN the skill template at
- WHEN a reader inspects the bash command on the first numbered step
- THEN the command is , not

### Scenario: skill propagates to installed projects
- GIVEN a project where  has been run
- WHEN the installer copies  from the template
- THEN the installed copy also invokes
