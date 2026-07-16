# instruction-contracts

## Requirement: Persona Text Is Derived At Runtime From The Agent Definition

The persona text emitted for an agent MUST be derived at runtime by parsing the corresponding agent
definition file's frontmatter and body — never read from a persona string literal declared in
command or generator source code. Editing the persona text in an agent definition file MUST change
what is emitted the next time instructions are generated for an artifact assigned to that agent,
with no source-code edit required. A source rebuild that only re-copies template assets into the
build output (with no logic change) MAY be required between editing the file and observing the new
output, and is acceptable; a change to compiled application logic MUST NOT be required.

### Scenario: Editing an agent definition file changes the emitted persona
- GIVEN an agent definition file whose persona text is "You are a technical researcher focused on evaluating implementation approaches."
- AND an artifact in the active workflow is assigned to that agent
- WHEN the persona sentence in the agent definition file is edited to a new sentence and, if required, the build's template assets are re-copied with no TypeScript logic change
- AND instructions are generated for that artifact
- THEN the emitted persona text contains the new sentence and does not contain the original sentence

### Scenario: No persona string literals remain in the instruction-generating source
- GIVEN the source files responsible for resolving an agent's persona for instruction generation
- WHEN those files are inspected for hardcoded persona sentences
- THEN no persona text for any agent is found declared as a string literal in source code
- AND every emitted persona traces to content read from an agent definition file at generation time


## Requirement: Every Referenced Agent Name Resolves To An Existing Agent Definition

Every agent name referenced by any artifact's agent assignment in a workflow definition MUST resolve
to an existing agent definition file. This resolution MUST be verifiable independent of any single
`metta instructions` invocation — i.e., it MUST be possible to enumerate every agent name referenced
across all workflow definitions and confirm each one has a backing agent definition file, with no
unresolved references left in the shipped workflow set.

### Scenario: All agent references across shipped workflows resolve
- GIVEN the full set of shipped workflow definitions
- WHEN every artifact's agent assignment across every workflow is collected into a set of referenced agent names
- THEN each referenced agent name has a corresponding agent definition file
- AND the set contains no name without a backing definition file

### Scenario: A newly introduced agent reference without a definition file is detectable
- GIVEN a workflow definition edited to assign an artifact to an agent name with no corresponding agent definition file
- WHEN the same enumeration check is run against that workflow
- THEN the check reports the undefined agent name as unresolved


## Requirement: Agent Resolution Failure Fails Loudly, Never Silently Substitutes

When an artifact's assigned agent name has no corresponding agent definition, generating
instructions for that artifact MUST fail with a typed, catchable error that names the missing agent
and the artifact that referenced it. The system MUST NOT substitute a different agent's persona,
capabilities, or tools in place of the unresolved one, and MUST NOT proceed to emit an instructions
contract for that artifact.

### Scenario: Unresolvable agent name produces a named error instead of a fallback persona
- GIVEN an artifact in the active workflow assigned to an agent name that has no corresponding agent definition file
- WHEN instructions are generated for that artifact
- THEN generation fails with an error identifying the unresolved agent name and the artifact id
- AND no instructions output containing another agent's persona is produced for that artifact

### Scenario: A resolvable agent name never triggers the failure path
- GIVEN an artifact assigned to an agent name that has a corresponding agent definition file
- WHEN instructions are generated for that artifact
- THEN generation succeeds and the emitted persona matches that agent's definition file
- AND no resolution-failure error is raised


## Requirement: Agent Aliases Are Explicit And Resolve To The Real Agent's Identity

If an agent name used in a workflow definition is an alias for a different underlying agent
definition (rather than a 1:1 name match), that alias MUST be declared through an explicit,
inspectable mapping rather than inferred through fallback logic. The instructions contract emitted
for an aliased agent name MUST carry the resolved agent's real name and persona — never a persona
belonging to an unrelated agent under the alias's name, and never the alias name presented as if it
were an independent agent identity when no such identity exists.

### Scenario: A declared alias resolves to its mapped agent's own persona
- GIVEN a workflow definition assigns an artifact to an agent name declared as an alias for a specific real agent definition
- WHEN instructions are generated for that artifact
- THEN the emitted agent name and persona match the real agent definition the alias is declared to point to
- AND the emitted persona is that agent's own persona text, not a persona belonging to a different, unrelated agent

### Scenario: An undeclared name is never treated as an implicit alias
- GIVEN a workflow definition assigns an artifact to an agent name with no explicit alias declaration and no matching agent definition file
- WHEN instructions are generated for that artifact
- THEN the system does not silently treat the name as an alias for any other agent
- AND the resolution-failure behavior applies instead


## Requirement: Emitted Instructions Contract Carries Complete Agent Identity

The instructions output for an artifact MUST include the resolved agent's name, persona, and tools,
all three sourced from that agent's definition file at generation time. The `tools` field MUST
reflect the tool list declared in the agent definition rather than a value computed or hardcoded
independently of it. Consumers of the instructions output (human or AI orchestrator) MUST be able to
determine, from the output alone, which agent produced the contract and what persona and tool
access that agent has.

### Scenario: Instructions output includes name, persona, and tools sourced from the same definition
- GIVEN an artifact assigned to an agent with a defined name, persona, and tool list
- WHEN instructions are generated for that artifact
- THEN the output's agent object contains a `name`, a `persona`, and a `tools` list
- AND each of those three values matches the corresponding value in that agent's definition file

### Scenario: A tool list change in the agent definition is reflected in the next generation
- GIVEN an agent definition whose tool list is edited to add or remove a tool
- WHEN instructions are next generated for an artifact assigned to that agent
- THEN the emitted `tools` list reflects the edited tool list


## Requirement: Source And Deployed Agent Definitions Remain Byte-Identical

For every agent definition file this capability sources persona, capability, and tool data from,
the source template copy and its deployed copy MUST remain byte-identical after any change that
touches either copy. A change that edits one copy without applying the identical edit to the other
MUST be detectable as a divergence.

### Scenario: Source and deployed agent definitions match after an edit
- GIVEN an agent definition file has a source template copy and a deployed copy
- WHEN either copy is edited as part of a change
- AND the corresponding edit is applied to the other copy
- THEN a byte-for-byte comparison of the two copies reports no difference

### Scenario: A divergence between source and deployed copies is detectable
- GIVEN an agent definition file's source template copy is edited without applying the same edit to its deployed copy
- WHEN a byte-for-byte comparison of the two copies is run
- THEN the comparison reports a difference between the two files
