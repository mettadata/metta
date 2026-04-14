# spec:-metta-fix-issues-cli-command-m

## Requirement: fix-issue-cli-command

MUST be implemented in  mirroring the
four-branch structure of . It MUST use the issues-domain severity enum
() rather than the gaps-domain enum ().
The command MUST accept an optional positional  argument plus options
, , and .
When no arguments are supplied the command MUST print usage instructions directing
the user to invoke the  skill for interactive selection. When a slug
is supplied the command MUST print issue details (title, severity, status, description)
and a delegate hint of the form
. When  is supplied the
command MUST list all open issues sorted by severity (critical first, then major, then
minor), one line per issue formatted as
. When  is combined
with  the command MUST filter to only issues matching that level. When
 is supplied the command MUST call 
then  and commit the changes with message
.
All branches MUST honour the  global flag, emitting structured JSON rather than
prose when set.

### Scenario: no-args prints usage
- GIVEN the user runs  with no additional arguments
- WHEN the command action executes
- THEN stdout contains the string  and references the
 skill for interactive selection, and the process exits with code 0

### Scenario: single-slug prints details and delegate hint
- GIVEN an issue with slug  exists in
- WHEN the user runs
- THEN stdout includes the issue title, severity, and status, and includes the text

### Scenario: single-slug not found exits non-zero
- GIVEN no issue file with slug  exists
- WHEN the user runs
- THEN stderr contains  and the process exits with code 4

### Scenario: --all lists issues sorted severity-first
- GIVEN three issues exist with severities critical, minor, and major respectively
- WHEN the user runs
- THEN stdout lists the critical issue first, the major issue second, the minor issue
third, each line tagged with its severity in brackets

### Scenario: --all --severity filters to matching tier
- GIVEN issues with severities critical, major, and minor exist
- WHEN the user runs
- THEN stdout contains only the critical issue and does not mention the major or minor
issues

### Scenario: --remove-issue archives and commits
- GIVEN an issue with slug  exists in
- WHEN the user runs
- THEN  exists,  does
not exist, and a git commit with message
 has been created


## Requirement: issues-store-archival

MUST gain two new methods:
 MUST read , create  if absent,
and write the identical content to .  MUST
call  first and MUST throw an error with a descriptive message if the
slug is not found in .  MUST be idempotent: if
 already exists the method MUST overwrite it without
error.
 MUST delete .  MUST succeed only when the file
exists at the issues path; it MUST throw if the file is absent (e.g., already removed).
Callers are expected to call  before ;  does not verify the
presence of the resolved copy.

### Scenario: archive moves content to resolved directory
- GIVEN  exists with content
- WHEN  is called
- THEN  exists and its content equals
, and  is unchanged

### Scenario: archive on missing slug throws
- GIVEN no file exists at
- WHEN  is called
- THEN the method throws an error and  is not
created

### Scenario: archive is idempotent when resolved copy already exists
- GIVEN  exists and 
already exists from a prior call
- WHEN  is called again
- THEN the method resolves without error and 
contains the current content of

### Scenario: remove deletes the open issue file
- GIVEN  exists
- WHEN  is called
- THEN  no longer exists


## Requirement: skill-template

A skill template MUST exist at
 with YAML frontmatter field
. At build/deploy time, or via , this file MUST
be copied byte-identical to .
The skill body MUST reference all four CLI invocation modes of :
The skill body MUST describe a propose-through-ship pipeline (propose → plan → execute →
review → verify → finalize → merge → remove-issue) modeled on the  skill.
After the merge step the skill MUST instruct the orchestrator to call
. The propose description pattern MUST be
.

### Scenario: template file exists with correct frontmatter name
- GIVEN the repository has been checked out
- WHEN  is read
- THEN the YAML frontmatter contains exactly

### Scenario: deployed skill is byte-identical to template
- GIVEN  (or the build copy step) has been run
- WHEN the bytes of  and
 are compared
- THEN the two files are byte-identical

### Scenario: skill body references all four CLI invocation modes
- GIVEN  is read
- WHEN the content is searched for CLI mode markers
- THEN the text contains references to , ,
, and the no-argument interactive-selection mode


## Requirement: cli-registration

MUST be registered in  by calling a
 function imported from
. The command MUST appear in the output of 
with a description matching  (or equivalent wording).

### Scenario: command appears in --help output
- GIVEN the CLI is built and runnable
- WHEN the user runs
- THEN stdout includes the string  with a short description

### Scenario: registerFixIssueCommand is called in index.ts
- GIVEN  is read
- WHEN the file content is searched for the registration call
- THEN it contains  (or equivalent) and the
import resolves to


## Requirement: fix-issue-cli-command

MUST be implemented in  mirroring the
four-branch structure of . It MUST use the issues-domain severity enum
() rather than the gaps-domain enum ().
The command MUST accept an optional positional  argument plus options
, , and .
When no arguments are supplied the command MUST print usage instructions directing
the user to invoke the  skill for interactive selection. When a slug
is supplied the command MUST print issue details (title, severity, status, description)
and a delegate hint of the form
. When  is supplied the
command MUST list all open issues sorted by severity (critical first, then major, then
minor), one line per issue formatted as
. When  is combined
with  the command MUST filter to only issues matching that level. When
 is supplied the command MUST call 
then  and commit the changes with message
.
All branches MUST honour the  global flag, emitting structured JSON rather than
prose when set.

### Scenario: no-args prints usage
- GIVEN the user runs  with no additional arguments
- WHEN the command action executes
- THEN stdout contains the string  and references the
 skill for interactive selection, and the process exits with code 0

### Scenario: single-slug prints details and delegate hint
- GIVEN an issue with slug  exists in
- WHEN the user runs
- THEN stdout includes the issue title, severity, and status, and includes the text

### Scenario: single-slug not found exits non-zero
- GIVEN no issue file with slug  exists
- WHEN the user runs
- THEN stderr contains  and the process exits with code 4

### Scenario: --all lists issues sorted severity-first
- GIVEN three issues exist with severities critical, minor, and major respectively
- WHEN the user runs
- THEN stdout lists the critical issue first, the major issue second, the minor issue
third, each line tagged with its severity in brackets

### Scenario: --all --severity filters to matching tier
- GIVEN issues with severities critical, major, and minor exist
- WHEN the user runs
- THEN stdout contains only the critical issue and does not mention the major or minor
issues

### Scenario: --remove-issue archives and commits
- GIVEN an issue with slug  exists in
- WHEN the user runs
- THEN  exists,  does
not exist, and a git commit with message
 has been created


## Requirement: issues-store-archival

MUST gain two new methods:
 MUST read , create  if absent,
and write the identical content to .  MUST
call  first and MUST throw an error with a descriptive message if the
slug is not found in .  MUST be idempotent: if
 already exists the method MUST overwrite it without
error.
 MUST delete .  MUST succeed only when the file
exists at the issues path; it MUST throw if the file is absent (e.g., already removed).
Callers are expected to call  before ;  does not verify the
presence of the resolved copy.

### Scenario: archive moves content to resolved directory
- GIVEN  exists with content
- WHEN  is called
- THEN  exists and its content equals
, and  is unchanged

### Scenario: archive on missing slug throws
- GIVEN no file exists at
- WHEN  is called
- THEN the method throws an error and  is not
created

### Scenario: archive is idempotent when resolved copy already exists
- GIVEN  exists and 
already exists from a prior call
- WHEN  is called again
- THEN the method resolves without error and 
contains the current content of

### Scenario: remove deletes the open issue file
- GIVEN  exists
- WHEN  is called
- THEN  no longer exists


## Requirement: skill-template

A skill template MUST exist at
 with YAML frontmatter field
. At build/deploy time, or via , this file MUST
be copied byte-identical to .
The skill body MUST reference all four CLI invocation modes of :
The skill body MUST describe a propose-through-ship pipeline (propose → plan → execute →
review → verify → finalize → merge → remove-issue) modeled on the  skill.
After the merge step the skill MUST instruct the orchestrator to call
. The propose description pattern MUST be
.

### Scenario: template file exists with correct frontmatter name
- GIVEN the repository has been checked out
- WHEN  is read
- THEN the YAML frontmatter contains exactly

### Scenario: deployed skill is byte-identical to template
- GIVEN  (or the build copy step) has been run
- WHEN the bytes of  and
 are compared
- THEN the two files are byte-identical

### Scenario: skill body references all four CLI invocation modes
- GIVEN  is read
- WHEN the content is searched for CLI mode markers
- THEN the text contains references to , ,
, and the no-argument interactive-selection mode


## Requirement: cli-registration

MUST be registered in  by calling a
 function imported from
. The command MUST appear in the output of 
with a description matching  (or equivalent wording).

### Scenario: command appears in --help output
- GIVEN the CLI is built and runnable
- WHEN the user runs
- THEN stdout includes the string  with a short description

### Scenario: registerFixIssueCommand is called in index.ts
- GIVEN  is read
- WHEN the file content is searched for the registration call
- THEN it contains  (or equivalent) and the
import resolves to


## Requirement: fix-issue-cli-command

MUST be implemented in  mirroring the
four-branch structure of . It MUST use the issues-domain severity enum
() rather than the gaps-domain enum ().
The command MUST accept an optional positional  argument plus options
, , and .
When no arguments are supplied the command MUST print usage instructions directing
the user to invoke the  skill for interactive selection. When a slug
is supplied the command MUST print issue details (title, severity, status, description)
and a delegate hint of the form
. When  is supplied the
command MUST list all open issues sorted by severity (critical first, then major, then
minor), one line per issue formatted as
. When  is combined
with  the command MUST filter to only issues matching that level. When
 is supplied the command MUST call 
then  and commit the changes with message
.
All branches MUST honour the  global flag, emitting structured JSON rather than
prose when set.

### Scenario: no-args prints usage
- GIVEN the user runs  with no additional arguments
- WHEN the command action executes
- THEN stdout contains the string  and references the
 skill for interactive selection, and the process exits with code 0

### Scenario: single-slug prints details and delegate hint
- GIVEN an issue with slug  exists in
- WHEN the user runs
- THEN stdout includes the issue title, severity, and status, and includes the text

### Scenario: single-slug not found exits non-zero
- GIVEN no issue file with slug  exists
- WHEN the user runs
- THEN stderr contains  and the process exits with code 4

### Scenario: --all lists issues sorted severity-first
- GIVEN three issues exist with severities critical, minor, and major respectively
- WHEN the user runs
- THEN stdout lists the critical issue first, the major issue second, the minor issue
third, each line tagged with its severity in brackets

### Scenario: --all --severity filters to matching tier
- GIVEN issues with severities critical, major, and minor exist
- WHEN the user runs
- THEN stdout contains only the critical issue and does not mention the major or minor
issues

### Scenario: --remove-issue archives and commits
- GIVEN an issue with slug  exists in
- WHEN the user runs
- THEN  exists,  does
not exist, and a git commit with message
 has been created


## Requirement: issues-store-archival

MUST gain two new methods:
 MUST read , create  if absent,
and write the identical content to .  MUST
call  first and MUST throw an error with a descriptive message if the
slug is not found in .  MUST be idempotent: if
 already exists the method MUST overwrite it without
error.
 MUST delete .  MUST succeed only when the file
exists at the issues path; it MUST throw if the file is absent (e.g., already removed).
Callers are expected to call  before ;  does not verify the
presence of the resolved copy.

### Scenario: archive moves content to resolved directory
- GIVEN  exists with content
- WHEN  is called
- THEN  exists and its content equals
, and  is unchanged

### Scenario: archive on missing slug throws
- GIVEN no file exists at
- WHEN  is called
- THEN the method throws an error and  is not
created

### Scenario: archive is idempotent when resolved copy already exists
- GIVEN  exists and 
already exists from a prior call
- WHEN  is called again
- THEN the method resolves without error and 
contains the current content of

### Scenario: remove deletes the open issue file
- GIVEN  exists
- WHEN  is called
- THEN  no longer exists


## Requirement: skill-template

A skill template MUST exist at
 with YAML frontmatter field
. At build/deploy time, or via , this file MUST
be copied byte-identical to .
The skill body MUST reference all four CLI invocation modes of :
The skill body MUST describe a propose-through-ship pipeline (propose → plan → execute →
review → verify → finalize → merge → remove-issue) modeled on the  skill.
After the merge step the skill MUST instruct the orchestrator to call
. The propose description pattern MUST be
.

### Scenario: template file exists with correct frontmatter name
- GIVEN the repository has been checked out
- WHEN  is read
- THEN the YAML frontmatter contains exactly

### Scenario: deployed skill is byte-identical to template
- GIVEN  (or the build copy step) has been run
- WHEN the bytes of  and
 are compared
- THEN the two files are byte-identical

### Scenario: skill body references all four CLI invocation modes
- GIVEN  is read
- WHEN the content is searched for CLI mode markers
- THEN the text contains references to , ,
, and the no-argument interactive-selection mode


## Requirement: cli-registration

MUST be registered in  by calling a
 function imported from
. The command MUST appear in the output of 
with a description matching  (or equivalent wording).

### Scenario: command appears in --help output
- GIVEN the CLI is built and runnable
- WHEN the user runs
- THEN stdout includes the string  with a short description

### Scenario: registerFixIssueCommand is called in index.ts
- GIVEN  is read
- WHEN the file content is searched for the registration call
- THEN it contains  (or equivalent) and the
import resolves to
